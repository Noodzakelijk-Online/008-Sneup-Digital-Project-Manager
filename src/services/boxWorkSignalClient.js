const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');
const API_URL = 'https://api.box.com/2.0';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = value => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, 160) : undefined; };
const validId = value => /^\d{1,24}$/.test(String(value || ''));
const validMarker = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && /^[A-Za-z0-9._~+/=-]+$/.test(value);
const parseDate = value => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const entry = item => { const createdAt = parseDate(item?.created_at); const updatedAt = parseDate(item?.modified_at); if (!validId(item?.id) || !['file', 'folder'].includes(item?.type) || (item?.created_at && !createdAt) || (item?.modified_at && !updatedAt)) return null; return compact({ id: `${item.type}:${item.id}`, sourceType: item.type, entryId: String(item.id), name: boundedText(item.name) || `Box ${item.type}`, status: item.item_status === 'trashed' ? 'archived' : 'open', createdAt: createdAt?.toISOString(), updatedAt: updatedAt?.toISOString() }); };
class BoxWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }
  getConfig() { return { timeout: clamp(process.env.SNEUP_BOX_TIMEOUT_MS, 15000, 1000, 60000), maxEntries: clamp(process.env.SNEUP_BOX_MAX_ENTRIES, 500, 1, 5000), pageSize: clamp(process.env.SNEUP_BOX_PAGE_SIZE, 100, 1, 1000) }; }
  getAccessToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.accessToken || credentials.token; if (!token) { const error = new Error('Box OAuth access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }
  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : null; if (cursor && !cursorDate) { const error = new Error('Box work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const config = this.getConfig(); const token = this.getAccessToken(account); const records = []; let marker; let pages = 0; let newest = cursorDate;
    do { const remaining = config.maxEntries - records.length; if (remaining <= 0) { const error = new Error('Box sync reached its configured entry limit. Increase SNEUP_BOX_MAX_ENTRIES before continuing.'); error.statusCode = 413; throw error; }
      const response = await this.http.get(`${API_URL}/folders/0/items`, { params: { usemarker: true, limit: Math.min(config.pageSize, remaining), fields: 'id,type,name,item_status,created_at,modified_at', ...(marker ? { marker } : {}) }, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); const entries = response?.data?.entries;
      if (!Array.isArray(entries) || entries.length > remaining) { const error = new Error('Box returned an invalid root metadata page. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      const normalized = entries.map(entry).filter(Boolean); if (normalized.length !== entries.length) { const error = new Error('Box returned an invalid root metadata entry. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      normalized.forEach(item => { const updatedAt = parseDate(item.updatedAt || item.createdAt); if (updatedAt && (!newest || updatedAt > newest)) newest = updatedAt; if (!cursorDate || !updatedAt || updatedAt >= cursorDate) records.push(item); }); pages += 1; marker = response?.data?.next_marker || null;
      if (marker && (!validMarker(marker) || entries.length >= remaining)) { const error = new Error('Box metadata pagination cannot continue safely. Reconnect this account before syncing again.'); error.statusCode = 413; throw error; }
    } while (marker);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'box_root_metadata', entries: records.length, pages, contentPolicy: 'root_metadata_only_no_file_contents_downloads_previews_shared_links_paths_descriptions_users_versions_comments_or_provider_writes' } };
  }
}
const boxWorkSignalClient = new BoxWorkSignalClient();
module.exports = boxWorkSignalClient;
module.exports.BoxWorkSignalClient = BoxWorkSignalClient;
