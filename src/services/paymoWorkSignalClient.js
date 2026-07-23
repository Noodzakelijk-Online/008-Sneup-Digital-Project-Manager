const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://app.paymoapp.com/api';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const parseDate = value => { const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? date : null; };
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
  const projectId = String(item?.id || ''); const name = boundedText(item?.name); const createdAt = parseDate(item?.created_on); const updatedAt = parseDate(item?.updated_on);
  if (!validId(projectId) || !name || (item?.active !== undefined && typeof item.active !== 'boolean') || (item?.created_on && !createdAt) || (item?.updated_on && !updatedAt)) return null;
  return compact({ id: `project:${projectId}`, sourceType: 'project', projectId, name, status: item.active === false ? 'archived' : 'open', createdAt: createdAt?.toISOString(), updatedAt: updatedAt?.toISOString() });
};

const priorityFor = value => ({ 25: 'low', 50: 'normal', 75: 'high', 100: 'critical' }[Number(value)]);
const taskRecord = (item, projectId) => {
  const taskId = String(item?.id || ''); const name = boundedText(item?.name); const dueAt = parseDate(item?.due_date); const createdAt = parseDate(item?.created_on); const updatedAt = parseDate(item?.updated_on); const priority = item?.priority === undefined || item?.priority === null || item?.priority === '' ? undefined : priorityFor(item.priority);
  if (!validId(taskId) || !name || String(item?.project_id || '') !== String(projectId) || (item?.complete !== undefined && typeof item.complete !== 'boolean') || (item?.due_date && !dueAt) || (item?.created_on && !createdAt) || (item?.updated_on && !updatedAt) || (item?.priority !== undefined && item?.priority !== null && item?.priority !== '' && !priority)) return null;
  return compact({ id: `task:${taskId}`, sourceType: 'task', taskId, projectId, name, status: item.complete === true ? 'done' : 'open', priority, dueAt: dueAt?.toISOString(), createdAt: createdAt?.toISOString(), updatedAt: updatedAt?.toISOString() });
};

class PaymoWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig() { return { timeout: clamp(process.env.SNEUP_PAYMO_TIMEOUT_MS, 15000, 1000, 60000), maxProjects: clamp(process.env.SNEUP_PAYMO_MAX_PROJECTS, 100, 1, 1000), maxTasks: clamp(process.env.SNEUP_PAYMO_MAX_TASKS, 2500, 1, 10000), maxResponseBytes: clamp(process.env.SNEUP_PAYMO_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000) }; }

  getApiKey(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const apiKey = credentials.apiKey || credentials.token || credentials.accessToken;
    if (!apiKey) throw error('Paymo API key is missing. Reconnect this account to continue syncing.', 503);
    return apiKey;
  }

  async request(config, apiKey, path, params, collectionKey) {
    const response = await this.http.get(`${API_URL}${path}`, {
      params: compact(params || {}),
      headers: { Accept: 'application/json' },
      auth: { username: apiKey, password: 'SneupReadOnly' },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
    const collection = response?.data?.[collectionKey];
    if (!Array.isArray(collection)) throw error('Paymo returned an invalid collection response. Reconnect this account before syncing again.');
    return collection;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const apiKey = this.getApiKey(account); const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) throw error('Paymo work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const projectsRaw = await this.request(config, apiKey, '/projects', { where: 'active=true' }, 'projects');
    if (projectsRaw.length > config.maxProjects) throw error('Paymo sync reached its configured project limit. Increase SNEUP_PAYMO_MAX_PROJECTS before continuing.', 413);
    const projects = projectsRaw.map(projectRecord);
    if (projects.some(item => !item)) throw error('Paymo returned invalid project metadata. Reconnect this account before syncing again.');
    const tasks = [];
    for (const project of projects) {
      const taskRaw = await this.request(config, apiKey, '/tasks', { where: `project_id=${project.projectId}` }, 'tasks');
      if (tasks.length + taskRaw.length > config.maxTasks) throw error('Paymo sync reached its configured task limit. Increase SNEUP_PAYMO_MAX_TASKS before continuing.', 413);
      const normalized = taskRaw.map(item => taskRecord(item, project.projectId));
      if (normalized.some(item => !item)) throw error('Paymo returned invalid task metadata. Reconnect this account before syncing again.');
      tasks.push(...normalized);
    }
    const records = [...projects, ...tasks].filter(item => { const updatedAt = parseDate(item.updatedAt || item.createdAt); return !cursorDate || !updatedAt || updatedAt >= cursorDate; });
    const newest = records.reduce((latest, item) => { const changed = parseDate(item.updatedAt || item.createdAt); return changed && (!latest || changed > latest) ? changed : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || new Date().toISOString(), hasMore: false, metadata: { source: 'paymo_api', projects: projects.length, tasks: tasks.length, contentPolicy: 'bounded_active_project_and_task_metadata_only_no_descriptions_comments_files_people_billing_budget_rates_clients_time_entries_urls_or_provider_writes' } };
  }
}

const paymoWorkSignalClient = new PaymoWorkSignalClient();
module.exports = paymoWorkSignalClient;
module.exports.PaymoWorkSignalClient = PaymoWorkSignalClient;
