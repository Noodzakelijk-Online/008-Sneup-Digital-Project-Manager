const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.miro.com/v2/boards';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const validId = value => /^[A-Za-z0-9_-]{4,128}$/.test(String(value || ''));
const parseDate = value => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const board = item => validId(item?.id) ? compact({
  id: `board:${item.id}`,
  sourceType: 'board',
  boardId: String(item.id),
  name: boundedText(item.name) || `Miro board ${item.id}`,
  status: 'open',
  boardType: boundedText(item.type, 48),
  createdAt: item.createdAt,
  updatedAt: item.modifiedAt
}) : null;

class MiroWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.now = options.now || (() => new Date()); }
  getConfig() { return { timeout: clamp(process.env.SNEUP_MIRO_TIMEOUT_MS, 15000, 1000, 60000), maxBoards: clamp(process.env.SNEUP_MIRO_MAX_BOARDS, 500, 1, 2500), pageSize: clamp(process.env.SNEUP_MIRO_PAGE_SIZE, 50, 1, 50), cursorLookbackMs: clamp(process.env.SNEUP_MIRO_CURSOR_LOOKBACK_MS, 60000, 0, 3600000), initialLookbackDays: clamp(process.env.SNEUP_MIRO_INITIAL_LOOKBACK_DAYS, 30, 1, 90) }; }
  getAccessToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const accessToken = credentials.accessToken || credentials.token; if (!accessToken) { const error = new Error('Miro OAuth access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return accessToken; }
  getTeamId(account) { return this.accountConnectorService.validateMiroTeamId(account?.metadata?.fields?.miroTeamId); }
  request(accessToken, config, params) { return this.http.get(API_URL, { params, headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }
  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const accessToken = this.getAccessToken(account); const teamId = this.getTeamId(account); const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) { const error = new Error('Miro work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const threshold = new Date((cursorDate ? cursorDate.getTime() - config.cursorLookbackMs : this.now().getTime() - config.initialLookbackDays * 86400000)); const records = []; let fetched = 0; let pages = 0; let offset = 0; let newest = cursorDate;
    while (true) {
      const remaining = config.maxBoards - fetched; if (remaining <= 0) { const error = new Error('Miro sync reached its configured board limit. Increase SNEUP_MIRO_MAX_BOARDS before continuing.'); error.statusCode = 413; throw error; }
      const limit = Math.min(config.pageSize, remaining); const response = await this.request(accessToken, config, { team_id: teamId, limit, offset, sort: 'last_modified' }); const items = response?.data?.data; const total = response?.data?.total;
      if (!Array.isArray(items) || items.length > limit || !Number.isInteger(total) || total < 0) { const error = new Error('Miro returned an invalid board page. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      if (total > config.maxBoards) { const error = new Error('Miro sync exceeds its configured board limit. Increase SNEUP_MIRO_MAX_BOARDS before continuing.'); error.statusCode = 413; throw error; }
      const normalized = items.map(board).filter(Boolean); fetched += items.length; pages += 1;
      for (const item of normalized) { const updated = parseDate(item.updatedAt || item.createdAt); if (!updated || updated >= threshold) { records.push(item); if (updated && (!newest || updated > newest)) newest = updated; } }
      if (fetched >= total) break;
      if (items.length === 0 || fetched >= config.maxBoards) { const error = new Error('Miro board pagination ended unexpectedly. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      offset += items.length;
    }
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'miro_boards_api', boards: records.length, pages, contentPolicy: 'board_metadata_only_no_descriptions_content_items_frames_sticky_notes_diagrams_comments_members_permissions_board_links_or_provider_writes' } };
  }
}
const miroWorkSignalClient = new MiroWorkSignalClient();
module.exports = miroWorkSignalClient;
module.exports.MiroWorkSignalClient = MiroWorkSignalClient;
