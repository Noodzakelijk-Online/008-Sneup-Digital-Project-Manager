const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_PATH = '/projects/api/v3';
const TEAMWORK_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.teamwork\.com$/;

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const compactObject = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));

const itemsFrom = (data, key) => {
  if (Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data?.data?.[key])) return data.data[key];
  if (Array.isArray(data?.results?.[key])) return data.results[key];
  if (Array.isArray(data?.items)) return data.items;
  return [];
};

const sanitizeProject = (project = {}) => compactObject({
  id: project.id ? `project:${project.id}` : undefined,
  sourceType: 'project',
  projectId: project.id,
  name: project.name,
  status: project.status,
  createdAt: project.dateCreated || project.createdAt,
  updatedAt: project.updatedAt || project.dateUpdated
});

const sanitizeTask = (task = {}) => {
  if (task.isPrivate === true) return null;
  return compactObject({
    id: task.id ? `task:${task.id}` : undefined,
    sourceType: 'task',
    taskId: task.id,
    projectId: task.projectId || task.project?.id,
    tasklistId: task.tasklistId || task.taskListId,
    parentTaskId: task.parentTaskId,
    name: task.name,
    status: task.status,
    priority: task.priority,
    startAt: task.startDate,
    dueAt: task.dueDate,
    createdAt: task.dateCreated || task.createdAt,
    updatedAt: task.dateUpdated || task.updatedAt,
    completedAt: task.dateCompleted || task.completedAt
  });
};

class TeamworkWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig(account) {
    return {
      apiUrl: this.getApiUrl(account),
      timeout: clampInteger(process.env.SNEUP_TEAMWORK_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clampInteger(process.env.SNEUP_TEAMWORK_MAX_PROJECTS, 100, 1, 500),
      maxTasks: clampInteger(process.env.SNEUP_TEAMWORK_MAX_TASKS, 2500, 1, 10000),
      pageSize: clampInteger(process.env.SNEUP_TEAMWORK_PAGE_SIZE, 100, 1, 500),
      cursorLookbackMs: clampInteger(process.env.SNEUP_TEAMWORK_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getApiUrl(account) {
    const raw = String(account?.metadata?.fields?.siteUrl || '').trim();
    let url;
    try {
      url = new URL(raw);
    } catch {
      const error = new Error('Teamwork site URL must be an HTTPS tenant URL such as https://your-site.teamwork.com.');
      error.statusCode = 400;
      throw error;
    }
    if (url.protocol !== 'https:' || !TEAMWORK_HOST.test(url.hostname) || url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      const error = new Error('Teamwork site URL must be an HTTPS tenant URL such as https://your-site.teamwork.com.');
      error.statusCode = 400;
      throw error;
    }
    return `${url.origin}${API_PATH}`;
  }

  getApiKey(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.apiKey || credentials.accessToken;
    if (!token) {
      const error = new Error('Teamwork API key is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  request(config, path, apiKey, params) {
    return this.http.get(`${config.apiUrl}${path}`, {
      params,
      timeout: config.timeout,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${apiKey}:password`).toString('base64')}`
      }
    });
  }

  async listCollection(config, apiKey, { path, key, limit, fields, updatedAfter, sanitize }) {
    const records = [];
    let page = 1;
    while (true) {
      const remaining = limit - records.length;
      if (remaining <= 0) {
        const error = new Error(`Teamwork sync reached its configured ${key} limit. Increase the corresponding SNEUP_TEAMWORK limit before continuing.`);
        error.statusCode = 413;
        throw error;
      }
      const requestedPageSize = Math.min(config.pageSize, remaining);
      const response = await this.request(config, path, apiKey, {
        page,
        pageSize: requestedPageSize,
        skipCounts: true,
        ...(updatedAfter ? { updatedAfter } : {}),
        [`fields[${key}]`]: fields.join(',')
      });
      const items = itemsFrom(response.data, key);
      if (items.length > remaining) {
        const error = new Error(`Teamwork returned more ${key} than Sneup is configured to process. Reconnect this account before syncing again.`);
        error.statusCode = 502;
        throw error;
      }
      records.push(...items.map(sanitize).filter(record => record?.id && record.name));
      if (items.length < requestedPageSize) return records;
      if (records.length >= limit) {
        const error = new Error(`Teamwork sync reached its configured ${key} limit. Increase the corresponding SNEUP_TEAMWORK limit before continuing.`);
        error.statusCode = 413;
        throw error;
      }
      page += 1;
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(account);
    const apiKey = this.getApiKey(account);
    const cursorDate = parseDate(cursor);
    const updatedAfter = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs).toISOString() : undefined;
    const projects = await this.listCollection(config, apiKey, {
      path: '/projects.json', key: 'projects', limit: config.maxProjects,
      fields: ['id', 'name', 'status', 'updatedAt'], updatedAfter, sanitize: sanitizeProject
    });
    const tasks = await this.listCollection(config, apiKey, {
      path: '/tasks.json', key: 'tasks', limit: config.maxTasks,
      fields: ['id', 'name', 'dateUpdated', 'parentTaskId', 'isPrivate', 'status', 'tasklistId', 'startDate', 'dueDate'], updatedAfter, sanitize: sanitizeTask
    });
    const records = [...projects, ...tasks];
    const newest = records.reduce((latest, record) => {
      const date = parseDate(record.updatedAt || record.createdAt || record.completedAt);
      return date && (!latest || date > latest) ? date : latest;
    }, cursorDate);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'teamwork_api',
        projects: projects.length,
        tasks: tasks.length,
        contentPolicy: 'project_task_metadata_only_private_tasks_excluded'
      }
    };
  }
}

const teamworkWorkSignalClient = new TeamworkWorkSignalClient();

module.exports = teamworkWorkSignalClient;
module.exports.TeamworkWorkSignalClient = TeamworkWorkSignalClient;
