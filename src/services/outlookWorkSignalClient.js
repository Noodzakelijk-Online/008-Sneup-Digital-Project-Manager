const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = value => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, 160) : undefined; };
const validId = value => typeof value === 'string' && value.length >= 8 && value.length <= 2048 && /^[A-Za-z0-9._~+/=-]+$/.test(value);
const parseDate = value => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const invalidResponse = message => { const error = new Error(message); error.statusCode = 502; return error; };
const limitReached = () => { const error = new Error('Outlook sync reached its configured inbox-message limit. Increase SNEUP_OUTLOOK_MAX_MESSAGES before continuing.'); error.statusCode = 413; return error; };

const message = item => {
  const receivedAt = parseDate(item?.receivedDateTime); const updatedAt = parseDate(item?.lastModifiedDateTime || item?.receivedDateTime);
  if (!validId(item?.conversationId) || (item?.receivedDateTime && !receivedAt) || (item?.lastModifiedDateTime && !updatedAt)) return null;
  return compact({ id: `conversation:${item.conversationId}`, sourceType: 'conversation', conversationId: item.conversationId, name: boundedText(item.subject) || 'Outlook conversation', status: item.isRead === false ? 'unread' : 'open', priority: ['low', 'normal', 'high'].includes(String(item.importance || '').toLowerCase()) ? String(item.importance).toLowerCase() : undefined, receivedAt: receivedAt?.toISOString(), updatedAt: updatedAt?.toISOString() });
};

class OutlookWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig() { return { apiUrl: String(process.env.SNEUP_MICROSOFT_GRAPH_API_URL || 'https://graph.microsoft.com/v1.0').replace(/\/$/, ''), timeout: clamp(process.env.SNEUP_OUTLOOK_TIMEOUT_MS, 15000, 1000, 60000), maxMessages: clamp(process.env.SNEUP_OUTLOOK_MAX_MESSAGES, 250, 1, 2000), pageSize: clamp(process.env.SNEUP_OUTLOOK_PAGE_SIZE, 100, 1, 1000) }; }

  getAccessToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.accessToken || credentials.token; if (!token) { const error = new Error('Outlook OAuth access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }

  request(path, token, params, config) { return this.http.get(`${config.apiUrl}${path}`, { params, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }

  nextToken(nextLink, config) {
    if (!nextLink) return null;
    if (typeof nextLink !== 'string' || nextLink.length > 4096) throw invalidResponse('Outlook returned an invalid inbox pagination link. Reconnect this account before syncing again.');
    let next;
    try { next = new URL(nextLink); } catch { throw invalidResponse('Outlook returned an invalid inbox pagination link. Reconnect this account before syncing again.'); }
    const expected = new URL(`${config.apiUrl}/me/mailFolders/inbox/messages`);
    if (next.origin !== expected.origin || next.pathname !== expected.pathname) throw invalidResponse('Outlook returned an unexpected inbox pagination location. Reconnect this account before syncing again.');
    const token = next.searchParams.get('$skiptoken');
    if (!validId(token)) throw invalidResponse('Outlook returned an invalid inbox pagination token. Reconnect this account before syncing again.');
    return token;
  }

  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) { const error = new Error('Outlook work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const config = this.getConfig(); const token = this.getAccessToken(account); const conversations = new Map(); const seenTokens = new Set(); let pageToken; let pages = 0; let scannedMessages = 0; let newest = cursorDate;
    do {
      const remaining = config.maxMessages - scannedMessages;
      if (remaining <= 0) throw limitReached();
      const response = await this.request('/me/mailFolders/inbox/messages', token, { '$top': Math.min(config.pageSize, remaining), '$orderby': 'lastModifiedDateTime desc', '$select': 'conversationId,subject,receivedDateTime,lastModifiedDateTime,isRead,importance', ...(pageToken ? { '$skiptoken': pageToken } : {}) }, config);
      const values = response?.data?.value;
      if (!Array.isArray(values) || values.length > remaining) throw invalidResponse('Outlook returned an invalid inbox-metadata page. Reconnect this account before syncing again.');
      const nextPageToken = this.nextToken(response?.data?.['@odata.nextLink'], config);
      if (nextPageToken && (values.length === 0 || seenTokens.has(nextPageToken))) throw invalidResponse('Outlook returned an unsafe inbox pagination sequence. Reconnect this account before syncing again.');
      if (nextPageToken && values.length >= remaining) throw limitReached();
      const normalized = values.map(message).filter(Boolean);
      if (normalized.length !== values.length) throw invalidResponse('Outlook returned invalid inbox-message metadata. Reconnect this account before syncing again.');
      normalized.forEach(item => { const current = conversations.get(item.conversationId); const updatedAt = parseDate(item.updatedAt); if (!current || (updatedAt && updatedAt > parseDate(current.updatedAt))) conversations.set(item.conversationId, item); if (updatedAt && (!newest || updatedAt > newest)) newest = updatedAt; });
      scannedMessages += values.length; pages += 1; if (nextPageToken) seenTokens.add(nextPageToken); pageToken = nextPageToken;
    } while (pageToken);
    const records = [...conversations.values()].filter(item => { const updatedAt = parseDate(item.updatedAt); return !cursorDate || !updatedAt || updatedAt >= cursorDate; });
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'outlook_inbox_conversation_metadata', conversations: records.length, scannedMessages, pages, contentPolicy: 'inbox_conversation_metadata_only_redacted_subjects_no_bodies_previews_attachments_sender_recipient_headers_message_ids_labels_raw_payloads_or_provider_writes' } };
  }
}

const outlookWorkSignalClient = new OutlookWorkSignalClient();
module.exports = outlookWorkSignalClient;
module.exports.OutlookWorkSignalClient = OutlookWorkSignalClient;
