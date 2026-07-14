const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const payload = response => response?.data?.data && typeof response.data.data === 'object' ? response.data.data : response?.data || {};
const parseDate = value => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = typeof value === 'number' || /^\d+$/.test(String(value));
  const parsed = new Date(numeric ? Number(value) * 1000 : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const safeUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && (url.hostname === 'freedcamp.com' || url.hostname.endsWith('.freedcamp.com')) ? url.toString() : undefined; } catch { return undefined; }
};
const project = item => validId(item?.project_id) && item.project_name ? compact({ id: `project:${item.project_id}`, sourceType: 'project', projectId: item.project_id, name: item.project_name, active: item.f_active !== false }) : null;
const task = (item, projects) => validId(item?.id) && item.title ? compact({
  id: `task:${item.id}`, sourceType: 'task', taskId: item.id, projectId: item.project_id, listId: item.list_id, name: item.title, project: projects.get(String(item.project_id)), status: item.status_title || item.status, priority: item.priority_title || item.priority, owners: item.assigned_to_fullname ? [item.assigned_to_fullname] : [], dueAt: parseDate(item.due_ts)?.toISOString(), createdAt: parseDate(item.created_ts)?.toISOString(), updatedAt: parseDate(item.completed_ts || item.created_ts)?.toISOString(), completedAt: parseDate(item.completed_ts)?.toISOString(), url: safeUrl(item.url)
}) : null;
const milestone = (item, projects) => validId(item?.id) && item.title ? compact({
  id: `milestone:${item.id}`, sourceType: 'milestone', milestoneId: item.id, projectId: item.project_id, name: item.title, project: projects.get(String(item.project_id)), status: item.status_title || item.status, priority: item.priority_title || item.priority, owners: item.assigned_to_fullname ? [item.assigned_to_fullname] : [], dueAt: parseDate(item.due_ts)?.toISOString(), createdAt: parseDate(item.created_ts)?.toISOString(), updatedAt: parseDate(item.updated_ts || item.created_ts)?.toISOString()
}) : null;

class FreedcampWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig() { return { apiUrl: 'https://freedcamp.com/api/v1', timeout: clamp(process.env.SNEUP_FREEDCAMP_TIMEOUT_MS, 15000, 1000, 60000), maxProjects: clamp(process.env.SNEUP_FREEDCAMP_MAX_PROJECTS, 100, 1, 500), maxTasks: clamp(process.env.SNEUP_FREEDCAMP_MAX_TASKS, 2500, 1, 10000), maxMilestones: clamp(process.env.SNEUP_FREEDCAMP_MAX_MILESTONES, 500, 1, 5000), pageSize: clamp(process.env.SNEUP_FREEDCAMP_PAGE_SIZE, 200, 1, 200), lookback: clamp(process.env.SNEUP_FREEDCAMP_CURSOR_LOOKBACK_MS, 60000, 0, 3600000) }; }

  getApiKey(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const key = credentials.apiKey || credentials.token || credentials.accessToken; if (!key) { const error = new Error('Freedcamp API key is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return key; }

  request(config, key, path, params) { return this.http.get(`${config.apiUrl}${path}`, { params, headers: { Accept: 'application/json', 'X-API-KEY': key }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }

  async listProjects(config, key) {
    const response = await this.request(config, key, '/projects'); const raw = payload(response).projects;
    if (!Array.isArray(raw)) { const error = new Error('Freedcamp returned an invalid project response. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
    if (raw.length > config.maxProjects) { const error = new Error('Freedcamp sync reached its configured project limit. Increase SNEUP_FREEDCAMP_MAX_PROJECTS before continuing.'); error.statusCode = 413; throw error; }
    return raw.map(project).filter(Boolean);
  }

  async listPaged(config, key, { path, key: collectionKey, limit, label, sanitize }) {
    const records = []; let offset = 0;
    while (true) {
      const remaining = limit - records.length;
      if (remaining <= 0) { const error = new Error(`Freedcamp sync reached its configured ${label} limit. Increase the corresponding SNEUP_FREEDCAMP limit before continuing.`); error.statusCode = 413; throw error; }
      const response = await this.request(config, key, path, { limit: Math.min(config.pageSize, remaining), offset }); const body = payload(response); const raw = body[collectionKey]; const meta = body.meta;
      if (!Array.isArray(raw) || typeof meta?.has_more !== 'boolean') { const error = new Error(`Freedcamp returned an ambiguous ${label} page. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
      if (Number.isFinite(Number(meta.total_count)) && Number(meta.total_count) > limit) { const error = new Error(`Freedcamp sync reached its configured ${label} limit. Increase the corresponding SNEUP_FREEDCAMP limit before continuing.`); error.statusCode = 413; throw error; }
      if (raw.length > remaining) { const error = new Error(`Freedcamp returned more ${label} than Sneup is configured to process. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
      records.push(...raw.map(sanitize).filter(Boolean));
      if (!meta.has_more) return records;
      if (records.length >= limit) { const error = new Error(`Freedcamp sync reached its configured ${label} limit. Increase the corresponding SNEUP_FREEDCAMP limit before continuing.`); error.statusCode = 413; throw error; }
      offset += Math.min(config.pageSize, remaining);
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const key = this.getApiKey(account); const cursorDate = parseDate(cursor);
    const projects = await this.listProjects(config, key); const projectMap = new Map(projects.map(item => [String(item.projectId), { id: item.projectId, name: item.name }]));
    const tasks = await this.listPaged(config, key, { path: '/tasks', key: 'tasks', limit: config.maxTasks, label: 'task', sanitize: item => task(item, projectMap) });
    const milestones = await this.listPaged(config, key, { path: '/milestones', key: 'milestones', limit: config.maxMilestones, label: 'milestone', sanitize: item => milestone(item, projectMap) });
    const records = [...projects, ...tasks, ...milestones].filter(item => { const updated = parseDate(item.updatedAt || item.createdAt); return !cursorDate || !updated || updated >= new Date(cursorDate.getTime() - config.lookback); });
    const newest = records.reduce((latest, item) => { const updated = parseDate(item.updatedAt || item.createdAt); return updated && (!latest || updated > latest) ? updated : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'freedcamp_api', projects: projects.length, tasks: tasks.length, milestones: milestones.length, contentPolicy: 'project_task_milestone_metadata_only_no_descriptions_comments_files_custom_fields_tags_or_provider_writes' } };
  }
}

const freedcampWorkSignalClient = new FreedcampWorkSignalClient();
module.exports = freedcampWorkSignalClient;
module.exports.FreedcampWorkSignalClient = FreedcampWorkSignalClient;
