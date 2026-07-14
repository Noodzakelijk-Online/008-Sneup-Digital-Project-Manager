const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');
const API_URL = 'https://api.dropboxapi.com/2/files';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const validId = value => /^id:[A-Za-z0-9_-]{4,128}$/.test(String(value || ''));
const parseDate = value => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const validCursor = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && /^[A-Za-z0-9._~+/=-]+$/.test(value);
const entry = item => validId(item?.id) && ['file', 'folder'].includes(item?.['.tag']) ? compact({ id: `${item['.tag']}:${item.id}`, sourceType: item['.tag'], entryId: item.id, name: boundedText(item.name) || `Dropbox ${item['.tag']}`, status: 'open', createdAt: item.client_modified, updatedAt: item.server_modified }) : null;
class DropboxWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.now = options.now || (() => new Date()); }
  getConfig() { return { timeout: clamp(process.env.SNEUP_DROPBOX_TIMEOUT_MS, 15000, 1000, 60000), maxEntries: clamp(process.env.SNEUP_DROPBOX_MAX_ENTRIES, 500, 1, 2500), pageSize: clamp(process.env.SNEUP_DROPBOX_PAGE_SIZE, 200, 1, 2000), initialLookbackDays: clamp(process.env.SNEUP_DROPBOX_INITIAL_LOOKBACK_DAYS, 30, 1, 90) }; }
  getAccessToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.accessToken || credentials.token; if (!token) { const error = new Error('Dropbox OAuth access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }
  request(path, token, config, body) { return this.http.post(`${API_URL}${path}`, body, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }
  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const token = this.getAccessToken(account); const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) { const error = new Error('Dropbox work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const threshold = new Date(this.now().getTime() - config.initialLookbackDays * 86400000); const records = []; let fetched = 0; let pages = 0; let pageCursor = null;
    while (true) {
      const remaining = config.maxEntries - fetched; if (remaining <= 0) { const error = new Error('Dropbox sync reached its configured entry limit. Increase SNEUP_DROPBOX_MAX_ENTRIES before continuing.'); error.statusCode = 413; throw error; }
      const body = pageCursor ? { cursor: pageCursor } : { path: '', recursive: false, include_deleted: false, include_media_info: false, include_mounted_folders: false, limit: Math.min(config.pageSize, remaining) };
      const response = await this.request(pageCursor ? '/list_folder/continue' : '/list_folder', token, config, body); const items = response?.data?.entries;
      if (!Array.isArray(items) || items.length > remaining || typeof response?.data?.has_more !== 'boolean') { const error = new Error('Dropbox returned an invalid metadata page. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      fetched += items.length; pages += 1; records.push(...items.map(entry).filter(Boolean).filter(item => { const updated = parseDate(item.updatedAt || item.createdAt); return !updated || updated >= threshold; }));
      if (!response.data.has_more) break;
      if (fetched >= config.maxEntries || !validCursor(response.data.cursor)) { const error = new Error('Dropbox metadata pagination cannot continue safely. Reconnect this account before syncing again.'); error.statusCode = 413; throw error; }
      pageCursor = response.data.cursor;
    }
    return { records, nextCursor: cursorDate ? cursorDate.toISOString() : null, hasMore: false, metadata: { source: 'dropbox_root_metadata', entries: records.length, pages, contentPolicy: 'root_metadata_only_no_file_contents_previews_downloads_shared_links_paper_docs_revisions_sharing_details_paths_or_provider_writes' } };
  }
}
const dropboxWorkSignalClient = new DropboxWorkSignalClient();
module.exports = dropboxWorkSignalClient;
module.exports.DropboxWorkSignalClient = DropboxWorkSignalClient;
