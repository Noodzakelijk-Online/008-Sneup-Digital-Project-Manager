const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const validId = value => /^[1-9][0-9]{0,18}$/.test(String(value || ''));
const validAccountId = value => /^[A-Za-z0-9_-]{1,80}$/.test(String(value || ''));
const boundedText = value => {
  const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 160) : undefined;
};
const parseDate = value => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const invalidResponse = message => {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
};
const normalizeStatus = value => ({ pending: 'open', future: 'open', inprogress: 'in_progress', completed: 'done', cancelled: 'archived' }[String(value || '').trim().toLowerCase()] || boundedText(value));

const project = value => {
  const projectId = String(value?.project_id || value?.id || '');
  const startAt = parseDate(value?.date || value?.start_date);
  const dueAt = parseDate(value?.deadline || value?.end_date);
  const updatedAt = parseDate(value?.modified_date || value?.updated_at);
  if (!validId(projectId) || !boundedText(value?.project_name || value?.name) || ((value?.date || value?.start_date) && !startAt) || ((value?.deadline || value?.end_date) && !dueAt) || ((value?.modified_date || value?.updated_at) && !updatedAt)) return null;
  return compact({ id: `project:${projectId}`, sourceType: 'project', projectId, name: boundedText(value.project_name || value.name), status: normalizeStatus(value.status), startAt: startAt?.toISOString(), dueAt: dueAt?.toISOString(), updatedAt: updatedAt?.toISOString() });
};

const task = value => {
  const taskId = String(value?.event_id || value?.task_id || value?.id || '');
  const projectId = value?.project_id === undefined || value?.project_id === null || value?.project_id === '' ? undefined : String(value.project_id);
  const dueAt = parseDate(value?.datetime_due || value?.due_date);
  const createdAt = parseDate(value?.created_date || value?.datetime_created);
  const updatedAt = parseDate(value?.modified_date || value?.updated_at);
  const completedAt = parseDate(value?.datetime_completed);
  const priorityId = value?.priority_id === undefined || value?.priority_id === null || value?.priority_id === '' ? undefined : Number(value.priority_id);
  if (!validId(taskId) || !boundedText(value?.event_name || value?.task_name || value?.name) || (projectId && !validId(projectId)) || ((value?.datetime_due || value?.due_date) && !dueAt) || ((value?.created_date || value?.datetime_created) && !createdAt) || ((value?.modified_date || value?.updated_at) && !updatedAt) || (value?.datetime_completed && !completedAt) || (value?.is_completed !== undefined && ![true, false, 0, 1, '0', '1'].includes(value.is_completed)) || (priorityId !== undefined && ![1, 2, 3].includes(priorityId))) return null;
  return compact({ id: `task:${taskId}`, sourceType: 'task', taskId, projectId, name: boundedText(value.event_name || value.task_name || value.name), status: [true, 1, '1'].includes(value.is_completed) ? 'done' : normalizeStatus(value.status) || 'open', priority: priorityId === 1 ? 'high' : priorityId === 3 ? 'low' : 'normal', dueAt: dueAt?.toISOString(), createdAt: createdAt?.toISOString(), updatedAt: updatedAt?.toISOString(), completedAt: completedAt?.toISOString() });
};

class ScoroWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig(account) {
    const raw = String(account?.metadata?.fields?.tenantUrl || '').trim();
    const accountId = String(account?.metadata?.fields?.accountId || '').trim();
    let url;
    try { url = new URL(raw); } catch { url = null; }
    const hostname = url?.hostname?.toLowerCase() || '';
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !/^[a-z0-9][a-z0-9-]{0,62}\.scoro\.com$/.test(hostname)) {
      const error = new Error('Scoro site URL must be a public HTTPS <company>.scoro.com URL without credentials, a custom port, path, query, or fragment.'); error.statusCode = 400; throw error;
    }
    if (!validAccountId(accountId)) { const error = new Error('Scoro account ID is invalid. Reconnect this account to continue syncing.'); error.statusCode = 400; throw error; }
    return {
      apiUrl: `${url.origin}/api/v2`, accountId,
      timeout: clamp(process.env.SNEUP_SCORO_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clamp(process.env.SNEUP_SCORO_MAX_PROJECTS, 250, 1, 1000),
      maxTasks: clamp(process.env.SNEUP_SCORO_MAX_TASKS, 1000, 1, 5000),
      pageSize: clamp(process.env.SNEUP_SCORO_PAGE_SIZE, 100, 1, 250),
      maxResponseBytes: clamp(process.env.SNEUP_SCORO_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000),
      cursorLookbackMs: clamp(process.env.SNEUP_SCORO_CURSOR_LOOKBACK_MS, 60000, 0, 24 * 60 * 60 * 1000)
    };
  }

  getApiKey(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const apiKey = credentials.apiKey || credentials.token || credentials.accessToken;
    if (!apiKey) { const error = new Error('Scoro API token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; }
    return apiKey;
  }

  async listCollection(endpoint, sourceType, limit, config, apiKey, cursorDate) {
    const records = []; let page = 1; let scanned = 0;
    while (true) {
      const remaining = limit - scanned;
      if (remaining <= 0) { const error = new Error(`Scoro sync reached its configured ${sourceType} limit. Increase the corresponding SNEUP_SCORO limit before continuing.`); error.statusCode = 413; throw error; }
      const pageSize = Math.min(config.pageSize, remaining);
      const response = await this.http.post(`${config.apiUrl}/${endpoint}/list`, { apiKey, company_account_id: config.accountId, lang: 'eng', page, per_page: pageSize, request: {} }, { headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, timeout: config.timeout, maxContentLength: config.maxResponseBytes, maxBodyLength: 64 * 1024, maxRedirects: 0, proxy: false });
      const values = response?.data?.data;
      if (!Array.isArray(values) || values.length > pageSize) throw invalidResponse('Scoro returned an invalid or over-limit metadata page. Reconnect this account before syncing again.');
      const normalized = values.map(sourceType === 'project' ? project : task);
      if (normalized.some(item => !item)) throw invalidResponse('Scoro returned invalid project or task metadata. Reconnect this account before syncing again.');
      scanned += values.length;
      records.push(...normalized.filter(item => { const updatedAt = parseDate(item.updatedAt || item.createdAt); return !cursorDate || !updatedAt || updatedAt >= cursorDate; }));
      if (values.length < pageSize) return { records, pages: page };
      if (scanned >= limit) { const error = new Error(`Scoro sync reached its configured ${sourceType} limit before the provider collection ended. Increase the corresponding SNEUP_SCORO limit before continuing.`); error.statusCode = 413; throw error; }
      page += 1;
    }
  }

  async fetchDelta(account, cursor) {
    const parsedCursor = cursor ? parseDate(cursor) : null;
    if (cursor && !parsedCursor) { const error = new Error('Scoro work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const config = this.getConfig(account); const cursorDate = parsedCursor ? new Date(parsedCursor.getTime() - config.cursorLookbackMs) : null; const apiKey = this.getApiKey(account);
    const projects = await this.listCollection('projects', 'project', config.maxProjects, config, apiKey, cursorDate);
    const tasks = await this.listCollection('tasks', 'task', config.maxTasks, config, apiKey, cursorDate);
    const records = [...projects.records, ...tasks.records];
    const newest = records.reduce((latest, record) => { const date = parseDate(record.updatedAt || record.createdAt); return date && (!latest || date > latest) ? date : latest; }, parsedCursor);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'scoro_project_task_metadata', projects: projects.records.length, tasks: tasks.records.length, pages: projects.pages + tasks.pages, contentPolicy: 'bounded_project_and_task_metadata_only_no_descriptions_comments_people_customer_crm_finance_utilization_custom_field_url_or_provider_write_content' } };
  }
}

const scoroWorkSignalClient = new ScoroWorkSignalClient();
module.exports = scoroWorkSignalClient;
module.exports.ScoroWorkSignalClient = ScoroWorkSignalClient;
