const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://gmail.googleapis.com/gmail/v1';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = value => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, 160) : undefined; };
const validThreadId = value => /^[a-f0-9]{8,64}$/i.test(String(value || ''));
const validPageToken = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && /^[A-Za-z0-9._~+/=-]+$/.test(value);
const parseDate = value => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const parseInternalDate = value => { if (value === undefined || value === null || value === '') return null; if (!/^\d{1,16}$/.test(String(value))) return null; const date = new Date(Number(value)); return Number.isNaN(date.getTime()) ? null : date; };
const invalidResponse = message => { const error = new Error(message); error.statusCode = 502; return error; };
const limitReached = () => { const error = new Error('Gmail sync reached its configured thread limit. Increase SNEUP_GMAIL_MAX_THREADS before continuing.'); error.statusCode = 413; return error; };

const subjectFrom = message => {
  const headers = message?.payload?.headers;
  if (!Array.isArray(headers)) return undefined;
  const subject = headers.find(header => String(header?.name || '').toLowerCase() === 'subject');
  return boundedText(subject?.value);
};

const normalizeThread = (thread, expectedId, maxMessagesPerThread) => {
  if (!validThreadId(thread?.id) || thread.id !== expectedId || !Array.isArray(thread.messages) || thread.messages.length === 0 || thread.messages.length > maxMessagesPerThread) return null;
  let latest;
  thread.messages.forEach(message => {
    const updatedAt = parseInternalDate(message?.internalDate);
    if (message?.internalDate && !updatedAt) { latest = false; return; }
    if (latest !== false && (!latest || (updatedAt && updatedAt > latest.updatedAt))) latest = { updatedAt, subject: subjectFrom(message) };
  });
  if (latest === false) return null;
  return compact({ id: `thread:${expectedId}`, sourceType: 'thread', threadId: expectedId, name: latest?.subject || 'Gmail thread', status: 'open', updatedAt: latest?.updatedAt?.toISOString() });
};

class GmailWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_GMAIL_TIMEOUT_MS, 15000, 1000, 60000),
      maxThreads: clamp(process.env.SNEUP_GMAIL_MAX_THREADS, 250, 1, 2000),
      pageSize: clamp(process.env.SNEUP_GMAIL_PAGE_SIZE, 100, 1, 500),
      concurrency: clamp(process.env.SNEUP_GMAIL_REQUEST_CONCURRENCY, 4, 1, 8),
      maxMessagesPerThread: clamp(process.env.SNEUP_GMAIL_MAX_MESSAGES_PER_THREAD, 200, 1, 500)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token;
    if (!token) { const error = new Error('Gmail OAuth access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; }
    return token;
  }

  request(path, token, params, config) {
    return this.http.get(`${API_URL}${path}`, { params, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false });
  }

  async fetchThread(threadId, token, config) {
    const response = await this.request(`/users/me/threads/${encodeURIComponent(threadId)}`, token, { format: 'metadata', metadataHeaders: ['Subject'] }, config);
    const normalized = normalizeThread(response?.data, threadId, config.maxMessagesPerThread);
    if (!normalized) throw invalidResponse('Gmail returned invalid thread metadata. Reconnect this account before syncing again.');
    return normalized;
  }

  async fetchThreadBatch(threadIds, token, config) {
    const records = [];
    for (let index = 0; index < threadIds.length; index += config.concurrency) {
      const batch = threadIds.slice(index, index + config.concurrency);
      records.push(...await Promise.all(batch.map(threadId => this.fetchThread(threadId, token, config))));
    }
    return records;
  }

  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) { const error = new Error('Gmail work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const config = this.getConfig(); const token = this.getAccessToken(account); const records = []; const seenPageTokens = new Set(); let pageToken; let pages = 0; let scannedThreads = 0; let newest = cursorDate;
    do {
      const remaining = config.maxThreads - scannedThreads;
      if (remaining <= 0) throw limitReached();
      const response = await this.request('/users/me/threads', token, { labelIds: 'INBOX', maxResults: Math.min(config.pageSize, remaining), ...(pageToken ? { pageToken } : {}) }, config);
      const threads = response?.data?.threads;
      if (!Array.isArray(threads) || threads.length > remaining) throw invalidResponse('Gmail returned an invalid inbox-thread page. Reconnect this account before syncing again.');
      const threadIds = threads.map(thread => validThreadId(thread?.id) ? thread.id : null);
      if (threadIds.some(threadId => !threadId) || new Set(threadIds).size !== threadIds.length) throw invalidResponse('Gmail returned an invalid inbox-thread identifier. Reconnect this account before syncing again.');
      const nextPageToken = response?.data?.nextPageToken || null;
      if (nextPageToken && (!validPageToken(nextPageToken) || threads.length === 0 || seenPageTokens.has(nextPageToken))) throw invalidResponse('Gmail returned an invalid inbox-thread pagination token. Reconnect this account before syncing again.');
      if (nextPageToken && threads.length >= remaining) throw limitReached();
      const normalized = await this.fetchThreadBatch(threadIds, token, config);
      normalized.forEach(item => {
        const updatedAt = parseDate(item.updatedAt);
        if (updatedAt && (!newest || updatedAt > newest)) newest = updatedAt;
        if (!cursorDate || !updatedAt || updatedAt >= cursorDate) records.push(item);
      });
      scannedThreads += threadIds.length;
      pages += 1;
      if (nextPageToken) seenPageTokens.add(nextPageToken);
      pageToken = nextPageToken;
    } while (pageToken);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'gmail_inbox_thread_metadata', threads: records.length, scannedThreads, pages, contentPolicy: 'inbox_thread_metadata_only_redacted_subjects_no_bodies_snippets_attachments_sender_recipient_headers_message_ids_labels_raw_payloads_or_provider_writes' } };
  }
}

const gmailWorkSignalClient = new GmailWorkSignalClient();
module.exports = gmailWorkSignalClient;
module.exports.GmailWorkSignalClient = GmailWorkSignalClient;
