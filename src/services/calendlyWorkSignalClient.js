const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');
const API_URL = 'https://api.calendly.com';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const validUri = value => /^https:\/\/api\.calendly\.com\/(?:users|event_types)\/[A-Za-z0-9-]{8,128}$/.test(String(value || ''));
const parseDate = value => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const eventType = item => validUri(item?.uri) ? compact({ id: `event_type:${item.uri.split('/').pop()}`, sourceType: 'event_type', eventTypeId: item.uri.split('/').pop(), name: boundedText(item.name) || 'Calendly event type', status: item.active === false ? 'archived' : 'open', durationMinutes: Number.isFinite(item.duration) ? item.duration : undefined, createdAt: item.created_at, updatedAt: item.updated_at }) : null;
class CalendlyWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.now = options.now || (() => new Date()); }
  getConfig() { return { timeout: clamp(process.env.SNEUP_CALENDLY_TIMEOUT_MS, 15000, 1000, 60000), maxEventTypes: clamp(process.env.SNEUP_CALENDLY_MAX_EVENT_TYPES, 250, 1, 2500), pageSize: clamp(process.env.SNEUP_CALENDLY_PAGE_SIZE, 100, 1, 100), initialLookbackDays: clamp(process.env.SNEUP_CALENDLY_INITIAL_LOOKBACK_DAYS, 30, 1, 90) }; }
  getToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.token || credentials.accessToken || credentials.apiKey; if (!token) { const error = new Error('Calendly personal access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }
  request(path, token, config, params) { return this.http.get(`${API_URL}${path}`, { params, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }
  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const token = this.getToken(account); const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) { const error = new Error('Calendly work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const me = await this.request('/users/me', token, config); const userUri = me?.data?.resource?.uri;
    if (!validUri(userUri) || !String(userUri).includes('/users/')) { const error = new Error('Calendly returned an invalid current-user identifier. Reconnect this account to continue.'); error.statusCode = 502; throw error; }
    const threshold = new Date(this.now().getTime() - config.initialLookbackDays * 86400000); const records = []; let fetched = 0; let pages = 0; let pageToken = null;
    while (true) {
      const remaining = config.maxEventTypes - fetched; if (remaining <= 0) { const error = new Error('Calendly sync reached its configured event-type limit. Increase SNEUP_CALENDLY_MAX_EVENT_TYPES before continuing.'); error.statusCode = 413; throw error; }
      const response = await this.request('/event_types', token, config, { user: userUri, count: Math.min(config.pageSize, remaining), ...(pageToken ? { page_token: pageToken } : {}) }); const items = response?.data?.collection;
      if (!Array.isArray(items) || items.length > remaining) { const error = new Error('Calendly returned an invalid event-type page. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      fetched += items.length; pages += 1; records.push(...items.map(eventType).filter(Boolean).filter(item => { const updated = parseDate(item.updatedAt || item.createdAt); return !updated || updated >= threshold; }));
      const next = response?.data?.pagination?.next_page_token; if (!next) break;
      if (typeof next !== 'string' || next.length > 2048 || !/^[A-Za-z0-9._~+/=-]+$/.test(next) || fetched >= config.maxEventTypes) { const error = new Error('Calendly event-type pagination cannot continue safely. Reconnect this account before syncing again.'); error.statusCode = 413; throw error; }
      pageToken = next;
    }
    return { records, nextCursor: cursorDate ? cursorDate.toISOString() : null, hasMore: false, metadata: { source: 'calendly_event_types', eventTypes: records.length, pages, contentPolicy: 'event_type_metadata_only_no_scheduled_events_invitees_booking_links_locations_routing_forms_availability_calendars_or_provider_writes' } };
  }
}
const calendlyWorkSignalClient = new CalendlyWorkSignalClient();
module.exports = calendlyWorkSignalClient;
module.exports.CalendlyWorkSignalClient = CalendlyWorkSignalClient;
