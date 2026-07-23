const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const GRAPH_API_URL = 'https://graph.microsoft.com/v1.0';
const GRAPH_HOSTS = new Set(['graph.microsoft.com', 'graph.microsoft.us', 'dod-graph.microsoft.us', 'microsoftgraph.chinacloudapi.cn']);
const safeId = value => /^[A-Za-z0-9_-]{1,200}$/.test(String(value || ''));
const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const parseDate = value => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const boundedText = value => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 160) : undefined;
};
const error = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });

const projectRecord = value => {
  const projectId = String(value?.id || '');
  const name = boundedText(value?.title);
  const createdAt = parseDate(value?.createdDateTime);
  if (!safeId(projectId) || !name || (value?.createdDateTime && !createdAt)) return null;
  return compact({ id: `project_plan:${projectId}`, sourceType: 'project', projectId, name, status: 'open', createdAt: createdAt?.toISOString() });
};

const taskRecord = (value, projectId) => {
  const taskId = String(value?.id || '');
  const name = boundedText(value?.title);
  const createdAt = parseDate(value?.createdDateTime);
  const updatedAt = parseDate(value?.lastModifiedDateTime);
  const dueAt = parseDate(value?.dueDateTime?.dateTime);
  const completedAt = parseDate(value?.completedDateTime?.dateTime);
  const percentComplete = value?.percentComplete;
  const priority = boundedText(value?.priority);
  if (!safeId(projectId) || !safeId(taskId) || !name || (value?.createdDateTime && !createdAt) || (value?.lastModifiedDateTime && !updatedAt) || (value?.dueDateTime?.dateTime && !dueAt) || (value?.completedDateTime?.dateTime && !completedAt) || (percentComplete !== undefined && (!Number.isInteger(percentComplete) || percentComplete < 0 || percentComplete > 100))) return null;
  return compact({ id: `project_task:${taskId}`, sourceType: 'task', taskId, projectId, name, status: percentComplete === 100 ? 'done' : percentComplete > 0 ? 'in_progress' : 'open', priority, percentComplete, dueAt: dueAt?.toISOString(), createdAt: createdAt?.toISOString(), updatedAt: updatedAt?.toISOString(), completedAt: completedAt?.toISOString() });
};

class MicrosoftProjectWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    const raw = String(process.env.SNEUP_MICROSOFT_PROJECT_GRAPH_API_URL || GRAPH_API_URL).trim();
    let apiUrl;
    try { apiUrl = new URL(raw); } catch { apiUrl = null; }
    if (!apiUrl || apiUrl.protocol !== 'https:' || !GRAPH_HOSTS.has(apiUrl.hostname.toLowerCase()) || apiUrl.port || apiUrl.pathname !== '/v1.0' || apiUrl.search || apiUrl.hash || apiUrl.username || apiUrl.password) throw error('Microsoft Project Graph API URL must be an approved Microsoft Graph v1.0 HTTPS endpoint.', 500);
    return {
      apiUrl: apiUrl.toString().replace(/\/$/, ''),
      timeout: clamp(process.env.SNEUP_MICROSOFT_PROJECT_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clamp(process.env.SNEUP_MICROSOFT_PROJECT_MAX_PROJECTS, 50, 1, 250),
      maxTasks: clamp(process.env.SNEUP_MICROSOFT_PROJECT_MAX_TASKS, 2500, 1, 5000),
      pageSize: clamp(process.env.SNEUP_MICROSOFT_PROJECT_PAGE_SIZE, 100, 1, 100),
      maxResponseBytes: clamp(process.env.SNEUP_MICROSOFT_PROJECT_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000),
      cursorLookbackMs: clamp(process.env.SNEUP_MICROSOFT_PROJECT_CURSOR_LOOKBACK_MS, 60000, 0, 24 * 60 * 60 * 1000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) throw error('Microsoft Project access token is missing. Reconnect this account to continue syncing.', 503);
    return token;
  }

  request(url, token, config, params) {
    return this.http.get(url, {
      ...(params ? { params } : {}),
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: 64 * 1024,
      maxRedirects: 0,
      proxy: false
    });
  }

  validateNextUrl(raw, config, expectedPath) {
    let url;
    let base;
    try { url = new URL(raw); base = new URL(config.apiUrl); } catch { url = null; }
    if (!url || !base || url.origin !== base.origin || url.pathname !== expectedPath || url.username || url.password || url.hash) throw error('Microsoft Project returned an untrusted pagination URL.');
    return url.toString();
  }

  async listPages({ initialPath, params, token, config, limit, label, transform }) {
    const records = [];
    let nextUrl = `${config.apiUrl}${initialPath}`;
    let firstPage = true;
    let pages = 0;
    while (nextUrl) {
      const remaining = limit - records.length;
      if (remaining <= 0) throw error(`Microsoft Project sync reached its configured ${label} limit. Increase the corresponding SNEUP_MICROSOFT_PROJECT limit before continuing.`, 413);
      const response = await this.request(nextUrl, token, config, firstPage ? { ...params, '$top': Math.min(config.pageSize, remaining) } : undefined);
      firstPage = false;
      const values = response?.data?.value;
      if (!Array.isArray(values) || values.length > remaining || values.length > config.pageSize) throw error('Microsoft Project returned an invalid or over-limit metadata page. Reconnect this account before syncing again.');
      const normalized = values.map(transform);
      if (normalized.some(item => !item)) throw error('Microsoft Project returned invalid plan or task metadata. Reconnect this account before syncing again.');
      records.push(...normalized);
      pages += 1;
      const rawNext = response.data?.['@odata.nextLink'];
      if (!rawNext) break;
      if (records.length >= limit) throw error(`Microsoft Project sync reached its configured ${label} limit before the provider collection ended. Increase the corresponding SNEUP_MICROSOFT_PROJECT limit before continuing.`, 413);
      if (values.length === 0) throw error('Microsoft Project returned an incomplete metadata page. Reconnect this account before syncing again.');
      nextUrl = this.validateNextUrl(rawNext, config, initialPath);
    }
    return { records, pages };
  }

  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) throw error('Microsoft Project work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const projects = await this.listPages({
      initialPath: '/me/planner/plans',
      params: { '$select': 'id,title,createdDateTime' },
      token,
      config,
      limit: config.maxProjects,
      label: 'project',
      transform: projectRecord
    });
    const tasks = [];
    let taskPages = 0;
    for (let index = 0; index < projects.records.length; index += 1) {
      const project = projects.records[index];
      const remaining = config.maxTasks - tasks.length;
      if (remaining <= 0) throw error('Microsoft Project sync reached its configured task limit before every project could be checked. Increase SNEUP_MICROSOFT_PROJECT_MAX_TASKS before continuing.', 413);
      const collection = await this.listPages({
        initialPath: `/planner/plans/${encodeURIComponent(project.projectId)}/tasks`,
        params: { '$select': 'id,title,planId,bucketId,percentComplete,priority,dueDateTime,completedDateTime,createdDateTime,lastModifiedDateTime' },
        token,
        config,
        limit: remaining,
        label: 'task',
        transform: item => taskRecord(item, project.projectId)
      });
      tasks.push(...collection.records);
      taskPages += collection.pages;
      if (tasks.length >= config.maxTasks && index < projects.records.length - 1) throw error('Microsoft Project sync reached its configured task limit before every project could be checked. Increase SNEUP_MICROSOFT_PROJECT_MAX_TASKS before continuing.', 413);
    }
    const lookback = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : null;
    const records = [...projects.records, ...tasks].filter(record => {
      const updatedAt = parseDate(record.updatedAt || record.createdAt || record.completedAt);
      return !lookback || !updatedAt || updatedAt >= lookback;
    });
    const newest = records.reduce((latest, record) => {
      const updatedAt = parseDate(record.updatedAt || record.createdAt || record.completedAt);
      return updatedAt && (!latest || updatedAt > latest) ? updatedAt : latest;
    }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'microsoft_project_planner_graph', projects: projects.records.length, tasks: tasks.length, pages: projects.pages + taskPages, contentPolicy: 'bounded_basic_planner_project_and_task_metadata_only_no_premium_plan_details_descriptions_checklists_comments_attachments_people_custom_fields_urls_or_provider_writes' } };
  }
}

const microsoftProjectWorkSignalClient = new MicrosoftProjectWorkSignalClient();
module.exports = microsoftProjectWorkSignalClient;
module.exports.MicrosoftProjectWorkSignalClient = MicrosoftProjectWorkSignalClient;
