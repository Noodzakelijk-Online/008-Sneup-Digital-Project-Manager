const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://chat.googleapis.com/v1';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const validSpace = value => /^spaces\/[A-Za-z0-9_-]{1,128}$/.test(String(value || ''));
const validToken = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && /^[A-Za-z0-9._~+/=-]+$/.test(value);
const parseDate = value => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const space = item => validSpace(item?.name) && item.spaceType === 'SPACE' ? compact({ id: `space:${item.name.slice('spaces/'.length)}`, sourceType: 'space', spaceId: item.name.slice('spaces/'.length), name: boundedText(item.displayName) || 'Google Chat space', status: 'open', spaceType: 'SPACE', createdAt: parseDate(item.createTime)?.toISOString(), updatedAt: parseDate(item.updateTime)?.toISOString() }) : null;

class GoogleChatWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }
  getConfig() { return { timeout: clamp(process.env.SNEUP_GOOGLE_CHAT_TIMEOUT_MS, 15000, 1000, 60000), maxSpaces: clamp(process.env.SNEUP_GOOGLE_CHAT_MAX_SPACES, 500, 1, 2500), pageSize: clamp(process.env.SNEUP_GOOGLE_CHAT_PAGE_SIZE, 100, 1, 1000) }; }
  getAccessToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.accessToken || credentials.token; if (!token) { const error = new Error('Google Chat access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }
  request(token, config, params) { return this.http.get(`${API_URL}/spaces`, { params, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }
  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) { const error = new Error('Google Chat work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const config = this.getConfig(); const token = this.getAccessToken(account); const records = []; let fetched = 0; let pages = 0; let pageToken;
    while (true) {
      const remaining = config.maxSpaces - fetched;
      if (remaining <= 0) { const error = new Error('Google Chat sync reached its configured space limit. Increase SNEUP_GOOGLE_CHAT_MAX_SPACES before continuing.'); error.statusCode = 413; throw error; }
      const response = await this.request(token, config, { pageSize: Math.min(config.pageSize, remaining), filter: 'spaceType = "SPACE"', ...(pageToken ? { pageToken } : {}) }); const items = response?.data?.spaces;
      if (!Array.isArray(items) || items.length > remaining) { const error = new Error('Google Chat returned an invalid space page. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      if (items.some(item => item?.spaceType === 'SPACE' && !validSpace(item?.name))) { const error = new Error('Google Chat returned an invalid named-space identifier. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      fetched += items.length; pages += 1; records.push(...items.map(space).filter(Boolean));
      const next = response?.data?.nextPageToken; if (!next) break;
      if (!validToken(next) || fetched >= config.maxSpaces) { const error = new Error('Google Chat space pagination cannot continue safely. Reconnect this account before syncing again.'); error.statusCode = 413; throw error; }
      pageToken = next;
    }
    return { records, nextCursor: cursorDate ? cursorDate.toISOString() : null, hasMore: false, metadata: { source: 'google_chat_spaces', spaces: records.length, pages, contentPolicy: 'named_space_metadata_only_no_messages_members_group_chats_direct_messages_descriptions_urls_or_provider_writes' } };
  }
}

const googleChatWorkSignalClient = new GoogleChatWorkSignalClient();
module.exports = googleChatWorkSignalClient;
module.exports.GoogleChatWorkSignalClient = GoogleChatWorkSignalClient;
