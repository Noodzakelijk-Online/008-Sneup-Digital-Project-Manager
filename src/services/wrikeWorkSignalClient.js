const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const DEFAULT_API_URL = 'https://www.wrike.com/api/v4';
const ALLOWED_API_HOSTS = new Set(['www.wrike.com', 'app-eu.wrike.com']);
const TASK_FIELDS = ['responsibleIds', 'parentIds', 'dependencyIds'];

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

const asItems = (response) => Array.isArray(response?.data?.data) ? response.data.data : [];

const safePermalink = (value) => {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_API_HOSTS.has(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const sanitizeProject = (project) => ({
  id: project.id,
  title: project.title,
  status: project.project?.status,
  ownerIds: project.project?.ownerIds,
  createdDate: project.createdDate,
  updatedDate: project.updatedDate,
  permalink: safePermalink(project.permalink)
});

const sanitizeTask = (task, projectsById) => ({
  id: task.id,
  title: task.title,
  status: task.status,
  importance: task.importance,
  createdDate: task.createdDate,
  updatedDate: task.updatedDate,
  dates: task.dates,
  responsibleIds: task.responsibleIds,
  parentIds: task.parentIds,
  dependencyIds: task.dependencyIds,
  projectNames: (task.parentIds || [])
    .map(parentId => projectsById.get(String(parentId))?.title)
    .filter(Boolean),
  permalink: safePermalink(task.permalink)
});

class WrikeWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig(account) {
    return {
      apiUrl: this.getApiUrl(account),
      timeout: clampInteger(process.env.SNEUP_WRIKE_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clampInteger(process.env.SNEUP_WRIKE_MAX_PROJECTS, 100, 1, 500),
      maxTasks: clampInteger(process.env.SNEUP_WRIKE_MAX_TASKS, 2500, 1, 10000),
      pageSize: clampInteger(process.env.SNEUP_WRIKE_PAGE_SIZE, 250, 1, 1000),
      cursorLookbackMs: clampInteger(process.env.SNEUP_WRIKE_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.accessToken || credentials.apiKey;
    if (!token) {
      const error = new Error('Wrike access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  getApiUrl(account) {
    const raw = String(account?.metadata?.fields?.apiUrl || process.env.SNEUP_WRIKE_API_URL || DEFAULT_API_URL).trim();
    let url;
    try {
      url = new URL(raw);
    } catch {
      const error = new Error('Wrike API URL must be https://www.wrike.com/api/v4 or https://app-eu.wrike.com/api/v4.');
      error.statusCode = 400;
      throw error;
    }
    if (url.protocol !== 'https:' || !ALLOWED_API_HOSTS.has(url.hostname) || url.pathname.replace(/\/$/, '') !== '/api/v4' || url.search || url.hash || url.username || url.password) {
      const error = new Error('Wrike API URL must be https://www.wrike.com/api/v4 or https://app-eu.wrike.com/api/v4.');
      error.statusCode = 400;
      throw error;
    }
    return url.toString().replace(/\/$/, '');
  }

  request(config, path, token, params = {}) {
    return this.http.get(`${config.apiUrl}${path}`, {
      params,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      },
      timeout: config.timeout
    });
  }

  async listProjects(token, config) {
    const projects = [];
    let nextPageToken;
    do {
      const remaining = config.maxProjects - projects.length;
      if (remaining <= 0) {
        const error = new Error('Wrike sync reached its configured project limit. Increase SNEUP_WRIKE_MAX_PROJECTS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      const response = await this.request(config, '/folders', token, {
        project: true,
        pageSize: Math.min(config.pageSize, remaining),
        ...(nextPageToken ? { nextPageToken } : {})
      });
      const page = asItems(response);
      projects.push(...page.map(sanitizeProject));
      nextPageToken = response.data?.nextPageToken;
      if (nextPageToken && projects.length >= config.maxProjects) {
        const error = new Error('Wrike sync reached its configured project limit. Increase SNEUP_WRIKE_MAX_PROJECTS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      if (nextPageToken && page.length === 0) {
        const error = new Error('Wrike returned an incomplete project page. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
    } while (nextPageToken);
    return projects;
  }

  async listTasks(token, config, cursorDate, projectsById) {
    const records = [];
    let newest = cursorDate;
    let nextPageToken;
    const updatedDate = cursorDate
      ? JSON.stringify({ start: new Date(cursorDate.getTime() - config.cursorLookbackMs).toISOString() })
      : undefined;
    do {
      const remaining = config.maxTasks - records.length;
      if (remaining <= 0) {
        const error = new Error('Wrike sync reached its configured task limit. Increase SNEUP_WRIKE_MAX_TASKS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      const response = await this.request(config, '/tasks', token, {
        pageSize: Math.min(config.pageSize, remaining),
        sortField: 'UpdatedDate',
        sortOrder: 'Desc',
        fields: JSON.stringify(TASK_FIELDS),
        ...(updatedDate ? { updatedDate } : {}),
        ...(nextPageToken ? { nextPageToken } : {})
      });
      const page = asItems(response);
      for (const task of page) {
        const record = sanitizeTask(task, projectsById);
        const updatedAt = parseDate(record.updatedDate || record.createdDate);
        if (updatedAt && (!newest || updatedAt > newest)) newest = updatedAt;
        records.push(record);
      }
      nextPageToken = response.data?.nextPageToken;
      if (nextPageToken && records.length >= config.maxTasks) {
        const error = new Error('Wrike sync reached its configured task limit. Increase SNEUP_WRIKE_MAX_TASKS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      if (nextPageToken && page.length === 0) {
        const error = new Error('Wrike returned an incomplete task page. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
    } while (nextPageToken);
    return { records, newest };
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(account);
    const token = this.getAccessToken(account);
    const cursorDate = parseDate(cursor);
    const projects = await this.listProjects(token, config);
    const projectsById = new Map(projects.map(project => [String(project.id), project]));
    const { records, newest } = await this.listTasks(token, config, cursorDate, projectsById);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: { source: 'wrike_api', projects: projects.length, items: records.length }
    };
  }
}

const wrikeWorkSignalClient = new WrikeWorkSignalClient();

module.exports = wrikeWorkSignalClient;
module.exports.WrikeWorkSignalClient = WrikeWorkSignalClient;
