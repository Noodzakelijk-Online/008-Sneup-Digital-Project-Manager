const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.clockify.me/api/v1';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const parseDate = value => { const parsed = new Date(value); return value && !Number.isNaN(parsed.getTime()) ? parsed : null; };
const validId = value => /^[A-Za-z0-9_-]{1,128}$/.test(String(value || ''));
const durationSeconds = (value) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(String(value || ''));
  if (!match) return undefined;
  const [, hours = '0', minutes = '0', seconds = '0'] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
};

const project = item => validId(item?.id) && item.name ? compact({ id: `project:${item.id}`, sourceType: 'project', projectId: item.id, name: item.name, archived: item.archived === true, billable: item.billable === true, workspaceId: item.workspaceId }) : null;
const timeEntry = (item, authenticatedUserId) => validId(item?.id) && validId(item?.workspaceId) ? compact({ id: `time_entry:${item.id}`, sourceType: 'time_entry', timeEntryId: item.id, workspaceId: item.workspaceId, projectId: item.projectId, taskId: item.taskId, userId: validId(authenticatedUserId) ? authenticatedUserId : undefined, startedAt: item.timeInterval?.start, stoppedAt: item.timeInterval?.end, durationSeconds: durationSeconds(item.timeInterval?.duration), billable: item.billable === true }) : null;

class ClockifyWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.now = options.now || (() => new Date()); }

  getConfig() { return { timeout: clamp(process.env.SNEUP_CLOCKIFY_TIMEOUT_MS, 15000, 1000, 60000), maxProjects: clamp(process.env.SNEUP_CLOCKIFY_MAX_PROJECTS, 500, 1, 5000), maxEntries: clamp(process.env.SNEUP_CLOCKIFY_MAX_ENTRIES, 2000, 1, 10000), pageSize: clamp(process.env.SNEUP_CLOCKIFY_PAGE_SIZE, 100, 1, 1000), initialLookbackDays: clamp(process.env.SNEUP_CLOCKIFY_INITIAL_LOOKBACK_DAYS, 30, 1, 90), cursorLookbackMs: clamp(process.env.SNEUP_CLOCKIFY_CURSOR_LOOKBACK_MS, 60000, 0, 3600000) }; }

  getWorkspaceId(account) { const workspaceId = String(account?.metadata?.fields?.workspaceId || '').trim(); if (!validId(workspaceId)) { const error = new Error('Clockify workspace ID is required. Reconnect this account with the workspace Sneup may read.'); error.statusCode = 400; throw error; } return workspaceId; }

  getApiKey(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const apiKey = credentials.apiKey || credentials.token || credentials.accessToken; if (!apiKey) { const error = new Error('Clockify API key is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return apiKey; }

  request(path, apiKey, config, params) { return this.http.get(`${API_URL}${path}`, { params, headers: { Accept: 'application/json', 'X-Api-Key': apiKey, 'User-Agent': 'Sneup Digital Project Manager (https://github.com/Noodzakelijk-Online/008-Sneup-Digital-Project-Manager)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }

  async listPages(path, apiKey, config, params, limit, label, sanitize) {
    const records = []; let processed = 0; let page = 1;
    while (true) {
      const response = await this.request(path, apiKey, config, { ...params, page, 'page-size': Math.min(config.pageSize, limit - processed) }); const raw = response.data; const lastPage = String(response.headers?.['last-page'] || '').toLowerCase();
      if (!Array.isArray(raw) || !['true', 'false'].includes(lastPage)) { const error = new Error(`Clockify returned an invalid ${label} page. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
      if (raw.length > limit - processed) { const error = new Error(`Clockify sync reached its configured ${label} limit. Increase the corresponding SNEUP_CLOCKIFY limit before continuing.`); error.statusCode = 413; throw error; }
      processed += raw.length; records.push(...raw.map(sanitize).filter(Boolean));
      if (lastPage === 'true') return records;
      if (raw.length === 0 || processed >= limit) { const error = new Error(`Clockify sync reached its configured ${label} limit or returned an incomplete page. Reconnect this account before syncing again.`); error.statusCode = processed >= limit ? 413 : 502; throw error; }
      page += 1;
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const apiKey = this.getApiKey(account); const workspaceId = this.getWorkspaceId(account); const userResponse = await this.request('/user', apiKey, config); const userId = String(userResponse.data?.id || '');
    if (!validId(userId)) { const error = new Error('Clockify returned an invalid authenticated user. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
    const cursorDate = parseDate(cursor); const now = this.now(); const start = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : new Date(now.getTime() - config.initialLookbackDays * 86400000);
    const [projects, entries] = await Promise.all([
      this.listPages(`/workspaces/${encodeURIComponent(workspaceId)}/projects`, apiKey, config, {}, config.maxProjects, 'project', project),
      this.listPages(`/workspaces/${encodeURIComponent(workspaceId)}/user/${encodeURIComponent(userId)}/time-entries`, apiKey, config, { start: start.toISOString(), end: now.toISOString(), hydrated: false }, config.maxEntries, 'time-entry', item => timeEntry(item, userId))
    ]);
    const records = [...projects, ...entries]; const newest = entries.reduce((latest, item) => { const updated = parseDate(item.stoppedAt || item.startedAt); return updated && (!latest || updated > latest) ? updated : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'clockify_api', workspaceId, projects: projects.length, timeEntries: entries.length, contentPolicy: 'authenticated_user_selected_workspace_project_and_utilization_metadata_with_opaque_user_id_only_for_explicit_capacity_mapping_no_descriptions_tags_clients_people_profiles_rates_custom_fields_or_provider_writes' } };
  }
}

const clockifyWorkSignalClient = new ClockifyWorkSignalClient();
module.exports = clockifyWorkSignalClient;
module.exports.ClockifyWorkSignalClient = ClockifyWorkSignalClient;
