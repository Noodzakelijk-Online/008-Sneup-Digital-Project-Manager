const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.float.com/v3';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const parseDate = value => { const parsed = new Date(value); return value && !Number.isNaN(parsed.getTime()) ? parsed : null; };
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const dateOnly = value => value.toISOString().slice(0, 10);

const project = item => validId(item?.project_id) && item.name ? compact({ id: `project:${item.project_id}`, sourceType: 'project', projectId: item.project_id, name: item.name, active: Number(item.active) === 1, status: item.status, startedAt: item.start_date, dueAt: item.end_date, createdAt: item.created, updatedAt: item.modified || item.created }) : null;
const allocation = item => validId(item?.task_id) && validId(item?.project_id) ? compact({ id: `allocation:${item.task_id}`, sourceType: 'allocation', allocationId: item.task_id, projectId: item.project_id, assigneeId: validId(item.people_id) ? item.people_id : undefined, startedAt: item.start_date, dueAt: item.end_date, scheduledHours: Number.isFinite(Number(item.hours)) ? Number(item.hours) : undefined, createdAt: item.created, updatedAt: item.modified || item.created }) : null;

class FloatWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.now = options.now || (() => new Date()); }

  getConfig() { return { timeout: clamp(process.env.SNEUP_FLOAT_TIMEOUT_MS, 15000, 1000, 60000), maxProjects: clamp(process.env.SNEUP_FLOAT_MAX_PROJECTS, 500, 1, 5000), maxAllocations: clamp(process.env.SNEUP_FLOAT_MAX_ALLOCATIONS, 2500, 1, 10000), pageSize: clamp(process.env.SNEUP_FLOAT_PAGE_SIZE, 200, 1, 200), initialLookbackDays: clamp(process.env.SNEUP_FLOAT_INITIAL_LOOKBACK_DAYS, 14, 1, 90), scheduleHorizonDays: clamp(process.env.SNEUP_FLOAT_SCHEDULE_HORIZON_DAYS, 90, 1, 365), cursorLookbackMs: clamp(process.env.SNEUP_FLOAT_CURSOR_LOOKBACK_MS, 60000, 0, 3600000) }; }

  getToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.apiToken || credentials.token || credentials.apiKey || credentials.accessToken; if (!token) { const error = new Error('Float API token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }

  request(path, token, config, params) { return this.http.get(`${API_URL}${path}`, { params, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }

  async listPages(path, token, config, params, limit, label, sanitize) {
    const records = []; let page = 1; let processed = 0;
    while (true) {
      const response = await this.request(path, token, config, { ...params, page, 'per-page': Math.min(config.pageSize, limit - processed) }); const raw = response.data; const total = Number(response.headers?.['x-pagination-total-count']); const current = Number(response.headers?.['x-pagination-current-page']); const pages = Number(response.headers?.['x-pagination-page-count']);
      if (!Array.isArray(raw) || !Number.isInteger(current) || current !== page || !Number.isInteger(pages) || pages < page || (Number.isFinite(total) && total < raw.length)) { const error = new Error(`Float returned an invalid ${label} page. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
      if ((Number.isFinite(total) && total > limit) || raw.length > limit - processed) { const error = new Error(`Float sync reached its configured ${label} limit. Increase the corresponding SNEUP_FLOAT limit before continuing.`); error.statusCode = 413; throw error; }
      processed += raw.length; records.push(...raw.map(sanitize).filter(Boolean));
      if (page >= pages) return records;
      if (processed >= limit || raw.length === 0) { const error = new Error(`Float sync reached its configured ${label} limit or returned an incomplete page. Reconnect this account before syncing again.`); error.statusCode = processed >= limit ? 413 : 502; throw error; }
      page += 1;
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const token = this.getToken(account); const cursorDate = parseDate(cursor); const now = this.now(); const start = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : new Date(now.getTime() - config.initialLookbackDays * 86400000); const end = new Date(now.getTime() + config.scheduleHorizonDays * 86400000);
    const [projects, allocations] = await Promise.all([
      this.listPages('/projects', token, config, { fields: 'project_id,name,active,status,start_date,end_date,created,modified' }, config.maxProjects, 'project', project),
      this.listPages('/tasks', token, config, { start_date: dateOnly(start), end_date: dateOnly(end), sort: '-modified', fields: 'task_id,project_id,people_id,start_date,end_date,hours,created,modified' }, config.maxAllocations, 'allocation', allocation)
    ]);
    const records = [...projects, ...allocations]; const newest = records.reduce((latest, item) => { const updated = parseDate(item.updatedAt || item.createdAt); return updated && (!latest || updated > latest) ? updated : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'float_api', projects: projects.length, allocations: allocations.length, scheduleStart: dateOnly(start), scheduleEnd: dateOnly(end), contentPolicy: 'project_and_allocation_schedule_metadata_only_server_field_allowlist_no_people_profiles_names_notes_clients_tags_rates_budgets_time_off_logged_time_or_provider_writes' } };
  }
}

const floatWorkSignalClient = new FloatWorkSignalClient();
module.exports = floatWorkSignalClient;
module.exports.FloatWorkSignalClient = FloatWorkSignalClient;
