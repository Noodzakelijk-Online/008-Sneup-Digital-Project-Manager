const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.ganttpro.com/v1.0';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const parseDate = value => { const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? date : null; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const error = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const boundedText = value => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 160) : undefined;
};

const projectRecord = item => {
  const projectId = String(item?.projectId || ''); const name = boundedText(item?.name); const updatedAt = parseDate(item?.lastUpdate);
  if (!validId(projectId) || !name || (item?.lastUpdate && !updatedAt)) return null;
  return compact({ id: `project:${projectId}`, sourceType: 'project', projectId, name, status: 'open', updatedAt: updatedAt?.toISOString() });
};

const taskRecord = (item, projectId) => {
  const taskId = String(item?.id || ''); const name = boundedText(item?.name); const createdAt = parseDate(item?.createdAt); const dueAt = parseDate(item?.deadline || item?.endDate); const startAt = parseDate(item?.startDate); const progress = Number(item?.progress);
  if (!validId(taskId) || !name || String(item?.projectId || projectId) !== String(projectId) || (item?.createdAt && !createdAt) || ((item?.deadline || item?.endDate) && !dueAt) || (item?.startDate && !startAt) || (item?.progress !== undefined && item?.progress !== null && item?.progress !== '' && (!Number.isFinite(progress) || progress < 0 || progress > 100))) return null;
  return compact({ id: `task:${taskId}`, sourceType: 'task', taskId, projectId, name, status: progress >= 100 ? 'done' : 'open', progressPercent: Number.isFinite(progress) ? progress : undefined, startAt: startAt?.toISOString(), dueAt: dueAt?.toISOString(), createdAt: createdAt?.toISOString() });
};

class GanttProWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig() { return { timeout: clamp(process.env.SNEUP_GANTTPRO_TIMEOUT_MS, 15000, 1000, 60000), maxProjects: clamp(process.env.SNEUP_GANTTPRO_MAX_PROJECTS, 100, 1, 1000), maxTasks: clamp(process.env.SNEUP_GANTTPRO_MAX_TASKS, 2500, 1, 10000), maxResponseBytes: clamp(process.env.SNEUP_GANTTPRO_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000) }; }

  getApiKey(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const apiKey = credentials.apiKey || credentials.token || credentials.accessToken;
    if (!apiKey) throw error('GanttPRO API key is missing. Reconnect this account to continue syncing.', 503);
    return apiKey;
  }

  async request(config, apiKey, path, params) {
    const response = await this.http.get(`${API_URL}${path}`, {
      params: compact(params || {}),
      headers: { Accept: 'application/json', 'X-API-Key': apiKey },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
    if (!Array.isArray(response?.data)) throw error('GanttPRO returned an invalid collection response. Reconnect this account before syncing again.');
    return response.data;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const apiKey = this.getApiKey(account); const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) throw error('GanttPRO work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const projectsRaw = await this.request(config, apiKey, '/projects');
    if (projectsRaw.length > config.maxProjects) throw error('GanttPRO sync reached its configured project limit. Increase SNEUP_GANTTPRO_MAX_PROJECTS before continuing.', 413);
    const projects = projectsRaw.map(projectRecord);
    if (projects.some(item => !item)) throw error('GanttPRO returned invalid project metadata. Reconnect this account before syncing again.');
    const tasks = [];
    for (const project of projects) {
      const taskRaw = await this.request(config, apiKey, '/tasks', { projectId: project.projectId });
      if (tasks.length + taskRaw.length > config.maxTasks) throw error('GanttPRO sync reached its configured task limit. Increase SNEUP_GANTTPRO_MAX_TASKS before continuing.', 413);
      const normalized = taskRaw.map(item => taskRecord(item, project.projectId));
      if (normalized.some(item => !item)) throw error('GanttPRO returned invalid task metadata. Reconnect this account before syncing again.');
      tasks.push(...normalized);
    }
    const records = [...projects, ...tasks];
    const newest = records.reduce((latest, item) => { const changed = parseDate(item.updatedAt || item.createdAt); return changed && (!latest || changed > latest) ? changed : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || new Date().toISOString(), hasMore: false, metadata: { source: 'ganttpro_api', projects: projects.length, tasks: tasks.length, contentPolicy: 'bounded_project_and_task_metadata_only_no_descriptions_comments_files_people_resources_links_custom_fields_or_provider_writes' } };
  }
}

const ganttProWorkSignalClient = new GanttProWorkSignalClient();
module.exports = ganttProWorkSignalClient;
module.exports.GanttProWorkSignalClient = GanttProWorkSignalClient;
