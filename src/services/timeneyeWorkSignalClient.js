const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.timeneye.com/api/v1';
const USER_AGENT = 'Sneup Digital Project Manager (https://github.com/Noodzakelijk-Online/008-Sneup-Digital-Project-Manager)';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const validId = value => /^[1-9][0-9]{0,18}$/.test(String(value || ''));
const parseDate = value => { const parsed = new Date(value); return value && !Number.isNaN(parsed.getTime()) ? parsed : null; };
const dateOnly = value => value.toISOString().slice(0, 10);
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));

const timeEntry = (item = {}) => {
  const entryId = item.entry_id;
  const minutes = Number(item.entry_minutes);
  const spentDate = parseDate(item.entry_date);
  if (!validId(entryId) || !Number.isInteger(minutes) || minutes < 0 || minutes > 60000 || !spentDate) return null;
  const createdAt = parseDate(item.created_date);
  const updatedAt = parseDate(item.updated_date);
  return compact({
    id: `time_entry:${entryId}`,
    sourceType: 'time_entry',
    timeEntryId: String(entryId),
    userId: validId(item.user_id) ? String(item.user_id) : undefined,
    projectId: validId(item.project_id) ? String(item.project_id) : undefined,
    phaseId: validId(item.phase_id) ? String(item.phase_id) : undefined,
    todoId: validId(item.todo_id) ? String(item.todo_id) : undefined,
    spentDate: dateOnly(spentDate),
    hours: minutes / 60,
    createdAt: createdAt?.toISOString(),
    updatedAt: updatedAt?.toISOString()
  });
};

class TimeneyeWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.now = options.now || (() => new Date()); }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_TIMENEYE_TIMEOUT_MS, 15000, 1000, 60000),
      maxEntries: clamp(process.env.SNEUP_TIMENEYE_MAX_ENTRIES, 2000, 1, 10000),
      pageSize: clamp(process.env.SNEUP_TIMENEYE_PAGE_SIZE, 100, 1, 100),
      initialLookbackDays: clamp(process.env.SNEUP_TIMENEYE_INITIAL_LOOKBACK_DAYS, 30, 1, 90),
      cursorLookbackMs: clamp(process.env.SNEUP_TIMENEYE_CURSOR_LOOKBACK_MS, 60000, 0, 3600000),
      maxResponseBytes: clamp(process.env.SNEUP_TIMENEYE_MAX_RESPONSE_BYTES, 1000000, 1024, 10000000)
    };
  }

  getMemberId(account) {
    const memberId = String(account?.metadata?.fields?.memberId || '').trim();
    if (!validId(memberId)) { const error = new Error('Lucen Track member ID is required. Reconnect this account with the one member Sneup may read.'); error.statusCode = 400; throw error; }
    return memberId;
  }

  getToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.apiToken || credentials.accessToken || credentials.apiKey;
    if (!token) { const error = new Error('Lucen Track personal access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; }
    return token;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const memberId = this.getMemberId(account); const token = this.getToken(account); const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) { const error = new Error('Lucen Track work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const now = this.now(); const start = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : new Date(now.getTime() - config.initialLookbackDays * 86400000);
    const records = []; let page = 1;
    while (true) {
      const remaining = config.maxEntries - records.length;
      const response = await this.http.get(`${API_URL}/entries`, {
        params: { page, per_page: Math.min(config.pageSize, remaining), sort_by: 'updated_date', direction: 'desc', 'member_ids[]': memberId, date_from: dateOnly(start), date_to: dateOnly(now) },
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
        timeout: config.timeout,
        maxContentLength: config.maxResponseBytes,
        maxBodyLength: config.maxResponseBytes,
        maxRedirects: 0,
        proxy: false
      });
      const items = response.data?.data;
      const meta = response.data?.meta;
      const currentPage = Number(meta?.current_page);
      const lastPage = Number(meta?.last_page);
      const total = Number(meta?.total);
      if (!Array.isArray(items) || !Number.isInteger(currentPage) || currentPage !== page || !Number.isInteger(lastPage) || lastPage < page || !Number.isInteger(total) || total < 0 || items.length > Math.min(config.pageSize, remaining)) {
        const error = new Error('Lucen Track returned an invalid time-entry page. Reconnect this account before syncing again.'); error.statusCode = 502; throw error;
      }
      if (total > config.maxEntries) { const error = new Error('Lucen Track sync reached its configured time-entry limit. Narrow the source window or increase SNEUP_TIMENEYE_MAX_ENTRIES before continuing.'); error.statusCode = 413; throw error; }
      records.push(...items.map(timeEntry).filter(Boolean));
      if (page === lastPage) break;
      if (records.length >= config.maxEntries || items.length === 0) { const error = new Error('Lucen Track sync reached its configured time-entry limit or returned an incomplete page. Reconnect this account before syncing again.'); error.statusCode = records.length >= config.maxEntries ? 413 : 502; throw error; }
      page += 1;
    }
    const newest = records.reduce((latest, item) => { const updated = parseDate(item.updatedAt || item.createdAt || item.spentDate); return updated && (!latest || updated > latest) ? updated : latest; }, cursorDate);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'lucen_track_timeneye_api',
        memberId,
        timeEntries: records.length,
        contentPolicy: 'selected_member_bounded_time_entry_utilization_metadata_with_opaque_ids_only_no_notes_clients_cost_revenue_profit_billing_lock_state_sources_urls_project_names_team_profiles_or_provider_writes'
      }
    };
  }
}

const timeneyeWorkSignalClient = new TimeneyeWorkSignalClient();
module.exports = timeneyeWorkSignalClient;
module.exports.TimeneyeWorkSignalClient = TimeneyeWorkSignalClient;
