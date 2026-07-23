const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const QUIP_API_URL = 'https://platform.quip.com';
const THREAD_TYPES = new Set(['document', 'spreadsheet', 'chat', 'channel', 'slide', 'slides']);
const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = value => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 160) : undefined;
};
const error = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const safeThreadId = value => /^[A-Za-z0-9_-]{10,32}$/.test(String(value || ''));
const safePageCursor = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001F\u007F]/.test(value);
const parseUsec = value => {
  if (value === undefined || value === null || value === '') return null;
  if (!/^\d{1,16}$/.test(String(value))) return null;
  const usec = Number(value);
  if (!Number.isSafeInteger(usec)) return null;
  const date = new Date(Math.floor(usec / 1000));
  return Number.isNaN(date.getTime()) ? null : date;
};
const parseCursor = value => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const threadRecord = value => {
  const threadId = String(value?.id || '');
  const type = String(value?.type || '').toLowerCase();
  const createdAt = parseUsec(value?.created_usec);
  const updatedAt = parseUsec(value?.updated_usec);
  if (!safeThreadId(threadId) || !THREAD_TYPES.has(type) || (value?.created_usec && !createdAt) || (value?.updated_usec && !updatedAt)) return null;
  return compact({
    id: `quip_thread:${threadId}`,
    sourceType: 'thread',
    threadId,
    threadType: type,
    name: boundedText(value?.title) || `Quip ${type}`,
    status: 'open',
    createdAt: createdAt?.toISOString(),
    updatedAt: updatedAt?.toISOString()
  });
};

class QuipWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_QUIP_TIMEOUT_MS, 15000, 1000, 60000),
      maxThreads: clamp(process.env.SNEUP_QUIP_MAX_THREADS, 1000, 1, 5000),
      pageSize: clamp(process.env.SNEUP_QUIP_PAGE_SIZE, 50, 1, 100),
      maxPages: clamp(process.env.SNEUP_QUIP_MAX_PAGES, 100, 1, 250),
      maxResponseBytes: clamp(process.env.SNEUP_QUIP_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000),
      cursorLookbackMs: clamp(process.env.SNEUP_QUIP_CURSOR_LOOKBACK_MS, 60000, 0, 24 * 60 * 60 * 1000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) throw error('Quip access token is missing. Reconnect this account to continue syncing.', 503);
    return token;
  }

  request(token, config, params) {
    return this.http.get(`${QUIP_API_URL}/1/users/current/threads`, {
      params,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: 64 * 1024,
      maxRedirects: 0,
      proxy: false
    });
  }

  async fetchDelta(account, cursor) {
    const cursorDate = parseCursor(cursor);
    if (cursor && !cursorDate) throw error('Quip work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const records = [];
    const seenCursors = new Set();
    let pageCursor;
    let pages = 0;

    while (true) {
      if (pages >= config.maxPages) throw error('Quip sync reached its configured page limit. Increase SNEUP_QUIP_MAX_PAGES before continuing.', 413);
      const remaining = config.maxThreads - records.length;
      if (remaining <= 0) throw error('Quip sync reached its configured thread limit. Increase SNEUP_QUIP_MAX_THREADS before continuing.', 413);
      const response = await this.request(token, config, compact({ limit: Math.min(config.pageSize, remaining), cursor: pageCursor }));
      const threads = response?.data?.threads;
      const nextCursor = response?.data?.response_metadata?.next_cursor;
      if (!Array.isArray(threads) || threads.length > remaining || threads.length > config.pageSize || (nextCursor && !safePageCursor(nextCursor))) throw error('Quip returned an invalid or over-limit thread metadata page. Reconnect this account before syncing again.');
      const normalized = threads.map(threadRecord);
      if (normalized.some(item => !item)) throw error('Quip returned invalid thread metadata. Reconnect this account before syncing again.');
      records.push(...normalized);
      pages += 1;
      if (!nextCursor) break;
      if (records.length >= config.maxThreads) throw error('Quip sync reached its configured thread limit before the provider collection ended. Increase SNEUP_QUIP_MAX_THREADS before continuing.', 413);
      if (threads.length === 0 || seenCursors.has(nextCursor)) throw error('Quip returned an incomplete or cyclic metadata page. Reconnect this account before syncing again.');
      seenCursors.add(nextCursor);
      pageCursor = nextCursor;
    }

    const lookback = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : null;
    const filtered = records.filter(record => {
      const updatedAt = parseCursor(record.updatedAt || record.createdAt);
      return !lookback || !updatedAt || updatedAt >= lookback;
    });
    const newest = filtered.reduce((latest, record) => {
      const updatedAt = parseCursor(record.updatedAt || record.createdAt);
      return updatedAt && (!latest || updatedAt > latest) ? updatedAt : latest;
    }, cursorDate);
    return {
      records: filtered,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'quip_thread_metadata',
        threads: records.length,
        pages,
        contentPolicy: 'bounded_quip_thread_index_metadata_only_no_document_or_spreadsheet_content_messages_members_folders_permissions_urls_attachments_or_provider_writes'
      }
    };
  }
}

const quipWorkSignalClient = new QuipWorkSignalClient();
module.exports = quipWorkSignalClient;
module.exports.QuipWorkSignalClient = QuipWorkSignalClient;
