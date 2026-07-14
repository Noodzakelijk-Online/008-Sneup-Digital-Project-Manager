const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.zoom.us/v2';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const validId = value => /^\d{1,20}$/.test(String(value || ''));
const parseDate = value => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const validPageToken = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && /^[A-Za-z0-9._~+/=-]+$/.test(value);
const meeting = item => validId(item?.id) ? compact({
  id: `meeting:${item.id}`,
  sourceType: 'scheduled_meeting',
  meetingId: String(item.id),
  name: boundedText(item.topic) || `Zoom meeting ${item.id}`,
  status: 'scheduled',
  meetingType: Number.isInteger(item.type) ? item.type : undefined,
  startAt: item.start_time,
  createdAt: item.created_at
}) : null;

class ZoomWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.now = options.now || (() => new Date()); }
  getConfig() { return { timeout: clamp(process.env.SNEUP_ZOOM_TIMEOUT_MS, 15000, 1000, 60000), maxMeetings: clamp(process.env.SNEUP_ZOOM_MAX_MEETINGS, 500, 1, 2500), pageSize: clamp(process.env.SNEUP_ZOOM_PAGE_SIZE, 100, 1, 300), initialLookbackDays: clamp(process.env.SNEUP_ZOOM_INITIAL_LOOKBACK_DAYS, 7, 1, 30) }; }
  getAccessToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const accessToken = credentials.accessToken || credentials.token; if (!accessToken) { const error = new Error('Zoom OAuth access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return accessToken; }
  request(accessToken, config, params) { return this.http.get(`${API_URL}/users/me/meetings`, { params, headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }
  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const accessToken = this.getAccessToken(account); const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) { const error = new Error('Zoom work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const threshold = new Date(this.now().getTime() - config.initialLookbackDays * 86400000); const records = []; let fetched = 0; let pages = 0; let nextPageToken = null;
    while (true) {
      const remaining = config.maxMeetings - fetched; if (remaining <= 0) { const error = new Error('Zoom sync reached its configured meeting limit. Increase SNEUP_ZOOM_MAX_MEETINGS before continuing.'); error.statusCode = 413; throw error; }
      const pageSize = Math.min(config.pageSize, remaining); const params = { type: 'scheduled', page_size: pageSize, ...(nextPageToken ? { next_page_token: nextPageToken } : {}) };
      const response = await this.request(accessToken, config, params); const items = response?.data?.meetings;
      if (!Array.isArray(items) || items.length > pageSize) { const error = new Error('Zoom returned an invalid meeting page. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      const normalized = items.map(meeting).filter(Boolean); fetched += items.length; pages += 1;
      records.push(...normalized.filter(item => { const start = parseDate(item.startAt); return !start || start >= threshold; }));
      const candidate = response?.data?.next_page_token;
      if (!candidate) break;
      if (!validPageToken(candidate)) { const error = new Error('Zoom returned an invalid meeting page token. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      if (fetched >= config.maxMeetings) { const error = new Error('Zoom sync reached its configured meeting limit before all pages completed. Increase SNEUP_ZOOM_MAX_MEETINGS before continuing.'); error.statusCode = 413; throw error; }
      nextPageToken = candidate;
    }
    return { records, nextCursor: cursorDate ? cursorDate.toISOString() : null, hasMore: false, metadata: { source: 'zoom_scheduled_meetings', meetings: records.length, pages, contentPolicy: 'scheduled_meeting_metadata_only_no_agendas_join_urls_passwords_hosts_attendees_recordings_transcripts_webinars_or_provider_writes' } };
  }
}
const zoomWorkSignalClient = new ZoomWorkSignalClient();
module.exports = zoomWorkSignalClient;
module.exports.ZoomWorkSignalClient = ZoomWorkSignalClient;
