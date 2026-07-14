const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.track.toggl.com/api/v9';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const parseDate = value => { const parsed = new Date(value); return value && !Number.isNaN(parsed.getTime()) ? parsed : null; };
const validId = value => /^[1-9][0-9]{0,18}$/.test(String(value || ''));

const project = item => validId(item?.id) && item.name ? compact({ id: `project:${item.id}`, sourceType: 'project', projectId: item.id, name: item.name, status: item.status?.name || item.status, isActive: item.active === true, createdAt: item.created_at, updatedAt: item.at || item.created_at }) : null;
const timeEntry = (item, workspaceId) => validId(item?.id) && String(item.workspace_id ?? item.wid) === workspaceId ? compact({ id: `time_entry:${item.id}`, sourceType: 'time_entry', timeEntryId: item.id, workspaceId: item.workspace_id ?? item.wid, projectId: item.project_id ?? item.pid, startedAt: item.start, stoppedAt: item.stop, durationSeconds: Number.isFinite(Number(item.duration)) ? Number(item.duration) : undefined, billable: item.billable === true, updatedAt: item.at || item.start }) : null;

class TogglTrackWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.now = options.now || (() => new Date()); }

  getConfig() { return { timeout: clamp(process.env.SNEUP_TOGGL_TIMEOUT_MS, 15000, 1000, 60000), maxProjects: clamp(process.env.SNEUP_TOGGL_MAX_PROJECTS, 500, 1, 5000), maxEntries: clamp(process.env.SNEUP_TOGGL_MAX_ENTRIES, 1000, 1, 1000), initialLookbackDays: clamp(process.env.SNEUP_TOGGL_INITIAL_LOOKBACK_DAYS, 30, 1, 90), cursorLookbackMs: clamp(process.env.SNEUP_TOGGL_CURSOR_LOOKBACK_MS, 60000, 0, 3600000) }; }

  getWorkspaceId(account) { const workspaceId = String(account?.metadata?.fields?.workspaceId || '').trim(); if (!validId(workspaceId)) { const error = new Error('Toggl Track workspace ID is required. Reconnect this account with the numeric workspace Sneup may read.'); error.statusCode = 400; throw error; } return workspaceId; }

  getToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.token || credentials.apiToken || credentials.apiKey || credentials.accessToken; if (!token) { const error = new Error('Toggl Track API token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }

  request(path, token, config, params) { return this.http.get(`${API_URL}${path}`, { params, headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${token}:api_token`).toString('base64')}`, 'User-Agent': 'Sneup Digital Project Manager (https://github.com/Noodzakelijk-Online/008-Sneup-Digital-Project-Manager)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }

  quota(headers = {}) { return compact({ remaining: Number.isFinite(Number(headers['x-toggl-quota-remaining'])) ? Number(headers['x-toggl-quota-remaining']) : undefined, resetsInSeconds: Number.isFinite(Number(headers['x-toggl-quota-resets-in'])) ? Number(headers['x-toggl-quota-resets-in']) : undefined }); }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const token = this.getToken(account); const workspaceId = this.getWorkspaceId(account); const cursorDate = parseDate(cursor); const now = this.now(); const start = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : new Date(now.getTime() - config.initialLookbackDays * 86400000);
    const [projectsResponse, entriesResponse] = await Promise.all([
      this.request(`/workspaces/${workspaceId}/projects`, token, config),
      this.request('/me/time_entries', token, config, { start_date: start.toISOString(), end_date: now.toISOString(), meta: false, include_sharing: false })
    ]);
    const rawProjects = projectsResponse.data; const rawEntries = entriesResponse.data;
    if (!Array.isArray(rawProjects) || !Array.isArray(rawEntries)) { const error = new Error('Toggl Track returned an invalid collection. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
    const reportedProjects = Number(rawProjects[0]?.total_count);
    if ((Number.isFinite(reportedProjects) && reportedProjects > config.maxProjects) || rawProjects.length > config.maxProjects) { const error = new Error('Toggl Track sync reached its configured project limit. Increase SNEUP_TOGGL_MAX_PROJECTS before continuing.'); error.statusCode = 413; throw error; }
    if (rawEntries.length >= config.maxEntries) { const error = new Error('Toggl Track sync reached its configured time-entry limit. Narrow the source window or increase SNEUP_TOGGL_MAX_ENTRIES before continuing.'); error.statusCode = 413; throw error; }
    const projects = rawProjects.map(project).filter(Boolean); const entries = rawEntries.map(item => timeEntry(item, workspaceId)).filter(Boolean); const records = [...projects, ...entries];
    const newest = records.reduce((latest, item) => { const updated = parseDate(item.updatedAt || item.startedAt || item.createdAt); return updated && (!latest || updated > latest) ? updated : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'toggl_track_api', workspaceId, projects: projects.length, timeEntries: entries.length, quota: this.quota(entriesResponse.headers), contentPolicy: 'selected_workspace_project_and_time_entry_utilization_metadata_only_no_descriptions_tags_clients_people_rates_sharing_notes_or_provider_writes' } };
  }
}

const togglTrackWorkSignalClient = new TogglTrackWorkSignalClient();
module.exports = togglTrackWorkSignalClient;
module.exports.TogglTrackWorkSignalClient = TogglTrackWorkSignalClient;
