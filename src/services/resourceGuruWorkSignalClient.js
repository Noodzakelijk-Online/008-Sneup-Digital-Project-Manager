const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.resourceguruapp.com/v1';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const parseDate = value => { const parsed = new Date(value); return value && !Number.isNaN(parsed.getTime()) ? parsed : null; };
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const validAccountUrlId = value => /^[a-z0-9][a-z0-9-]{0,62}$/.test(String(value || ''));
const dateOnly = value => value.toISOString().slice(0, 10);

const project = item => validId(item?.id) && item.name ? compact({ id: `project:${item.id}`, sourceType: 'project', projectId: item.id, name: item.name, archived: Boolean(item.archived), startedAt: item.start_date, dueAt: item.end_date, createdAt: item.created_at, updatedAt: item.updated_at || item.created_at }) : null;
const booking = item => validId(item?.id) ? compact({ id: `booking:${item.id}`, sourceType: 'booking', bookingId: item.id, projectId: validId(item.project_id) ? item.project_id : undefined, resourceId: validId(item.resource_id) ? item.resource_id : undefined, approvalState: ['pending', 'approved', 'declined'].includes(item.approval_state) ? item.approval_state : undefined, startedAt: item.start_date, dueAt: item.end_date, scheduledMinutes: Number.isFinite(Number(item.duration)) ? Number(item.duration) : undefined, createdAt: item.created_at, updatedAt: item.updated_at || item.created_at }) : null;

class ResourceGuruWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.now = options.now || (() => new Date()); }

  getConfig() { return { timeout: clamp(process.env.SNEUP_RESOURCE_GURU_TIMEOUT_MS, 15000, 1000, 60000), maxProjects: clamp(process.env.SNEUP_RESOURCE_GURU_MAX_PROJECTS, 500, 1, 5000), maxBookings: clamp(process.env.SNEUP_RESOURCE_GURU_MAX_BOOKINGS, 2500, 1, 10000), pageSize: clamp(process.env.SNEUP_RESOURCE_GURU_PAGE_SIZE, 100, 1, 200), initialLookbackDays: clamp(process.env.SNEUP_RESOURCE_GURU_INITIAL_LOOKBACK_DAYS, 14, 1, 90), scheduleHorizonDays: clamp(process.env.SNEUP_RESOURCE_GURU_SCHEDULE_HORIZON_DAYS, 90, 1, 365), cursorLookbackMs: clamp(process.env.SNEUP_RESOURCE_GURU_CURSOR_LOOKBACK_MS, 60000, 0, 3600000) }; }

  getToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.accessToken || credentials.token || credentials.apiKey; if (!token) { const error = new Error('Resource Guru access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }

  getAccountUrlId(account) { const fields = account?.metadata?.fields || {}; const accountId = String(fields.resourceGuruAccountId || '').trim(); const accountUrlId = String(fields.resourceGuruAccountUrlId || '').trim().toLowerCase(); if (!validId(accountId) || !validAccountUrlId(accountUrlId)) { const error = new Error('Select an authorized Resource Guru account before syncing.'); error.statusCode = 409; throw error; } return accountUrlId; }

  request(accountUrlId, path, token, config, params) { return this.http.get(`${API_URL}/${encodeURIComponent(accountUrlId)}${path}`, { params, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }

  async listPages(accountUrlId, path, token, config, params, limit, label, sanitize) {
    const records = []; let offset = 0;
    while (true) {
      const pageSize = Math.min(config.pageSize, limit - offset);
      const response = await this.request(accountUrlId, path, token, config, { ...params, limit: pageSize, offset });
      const raw = response.data;
      if (!Array.isArray(raw) || raw.length > pageSize) { const error = new Error(`Resource Guru returned an invalid ${label} page. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
      records.push(...raw.map(sanitize).filter(Boolean));
      offset += raw.length;
      if (raw.length < pageSize) return records;
      if (offset >= limit) {
        const probe = await this.request(accountUrlId, path, token, config, { ...params, limit: 1, offset });
        if (!Array.isArray(probe.data)) { const error = new Error(`Resource Guru returned an invalid ${label} pagination probe. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
        if (probe.data.length > 0) { const error = new Error(`Resource Guru sync reached its configured ${label} limit. Increase the corresponding SNEUP_RESOURCE_GURU limit before continuing.`); error.statusCode = 413; throw error; }
        return records;
      }
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const token = this.getToken(account); const accountUrlId = this.getAccountUrlId(account); const cursorDate = parseDate(cursor); const now = this.now(); const start = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : new Date(now.getTime() - config.initialLookbackDays * 86400000); const end = new Date(now.getTime() + config.scheduleHorizonDays * 86400000);
    const [projects, bookings] = await Promise.all([
      this.listPages(accountUrlId, '/projects', token, config, {}, config.maxProjects, 'project', project),
      this.listPages(accountUrlId, '/bookings', token, config, { start_date: dateOnly(start), end_date: dateOnly(end), calendar: 0, include_non_bookable_resources: 0 }, config.maxBookings, 'booking', booking)
    ]);
    const records = [...projects, ...bookings]; const newest = records.reduce((latest, item) => { const updated = parseDate(item.updatedAt || item.createdAt); return updated && (!latest || updated > latest) ? updated : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'resource_guru_api', accountUrlId, projects: projects.length, bookings: bookings.length, scheduleStart: dateOnly(start), scheduleEnd: dateOnly(end), contentPolicy: 'project_and_booking_schedule_metadata_only_selected_account_no_resource_profiles_names_notes_clients_rates_availability_timesheets_or_provider_writes' } };
  }
}

const resourceGuruWorkSignalClient = new ResourceGuruWorkSignalClient();
module.exports = resourceGuruWorkSignalClient;
module.exports.ResourceGuruWorkSignalClient = ResourceGuruWorkSignalClient;
