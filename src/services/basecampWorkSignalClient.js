const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const BASECAMP_HOST = '3.basecampapi.com';

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

const getNextLink = (link) => {
  if (!link) return null;
  const next = String(link).split(',').map(item => item.trim()).find(item => /;\s*rel="?next"?$/i.test(item));
  const match = next && next.match(/^<([^>]+)>/);
  return match ? match[1] : null;
};

class BasecampWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig(account) {
    return {
      apiUrl: this.getApiUrl(account),
      timeout: clampInteger(process.env.SNEUP_BASECAMP_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clampInteger(process.env.SNEUP_BASECAMP_MAX_PROJECTS, 25, 1, 200),
      maxTodoListsPerProject: clampInteger(process.env.SNEUP_BASECAMP_MAX_TODO_LISTS_PER_PROJECT, 100, 1, 500),
      maxTodosPerList: clampInteger(process.env.SNEUP_BASECAMP_MAX_TODOS_PER_LIST, 250, 1, 1000),
      maxTotalTodos: clampInteger(process.env.SNEUP_BASECAMP_MAX_TOTAL_TODOS, 2500, 1, 10000),
      cursorLookbackMs: clampInteger(process.env.SNEUP_BASECAMP_CURSOR_LOOKBACK_MS, 60000, 0, 3600000),
      userAgent: String(process.env.SNEUP_BASECAMP_USER_AGENT || 'Sneup-Digital-Project-Manager').slice(0, 200)
    };
  }

  getApiUrl(account) {
    const fields = account?.metadata?.fields || {};
    const accountId = String(fields.basecampAccountId || '').trim();
    const raw = String(fields.basecampApiUrl || '').trim();
    let url;
    try {
      url = new URL(raw);
    } catch {
      url = null;
    }
    if (!/^\d{1,20}$/.test(accountId) || !url || url.protocol !== 'https:' || url.hostname !== BASECAMP_HOST || url.port || url.pathname !== `/${accountId}` || url.search || url.hash || url.username || url.password) {
      const error = new Error('Select one authorized Basecamp account before syncing.');
      error.statusCode = 409;
      throw error;
    }
    return url.toString().replace(/\/$/, '');
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('Basecamp access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  validatePageUrl(raw, config) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      url = null;
    }
    const base = new URL(config.apiUrl);
    if (!url || url.protocol !== 'https:' || url.hostname !== BASECAMP_HOST || url.port || url.username || url.password || !url.pathname.startsWith(`${base.pathname}/`)) {
      const error = new Error('Basecamp returned an untrusted pagination URL.');
      error.statusCode = 502;
      throw error;
    }
    return url.toString();
  }

  async get(url, config, token) {
    return this.http.get(url, {
      timeout: config.timeout,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': config.userAgent
      }
    });
  }

  async listCollection(url, config, token, limit, label) {
    const records = [];
    let nextUrl = url;
    while (nextUrl) {
      if (records.length >= limit) {
        const error = new Error(`Basecamp sync reached its configured ${label} limit. Increase the corresponding SNEUP_BASECAMP limit before continuing.`);
        error.statusCode = 413;
        throw error;
      }
      const response = await this.get(nextUrl, config, token);
      const items = Array.isArray(response.data) ? response.data : [];
      if (items.length > limit - records.length) {
        const error = new Error(`Basecamp returned more ${label} than Sneup is configured to process.`);
        error.statusCode = 413;
        throw error;
      }
      records.push(...items);
      const rawNext = getNextLink(response.headers?.link || response.headers?.Link);
      nextUrl = rawNext ? this.validatePageUrl(rawNext, config) : null;
      if (nextUrl && records.length >= limit) {
        const error = new Error(`Basecamp sync reached its configured ${label} limit. Increase the corresponding SNEUP_BASECAMP limit before continuing.`);
        error.statusCode = 413;
        throw error;
      }
    }
    return records;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(account);
    const token = this.getAccessToken(account);
    const cursorDate = parseDate(cursor);
    const updatedAfter = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : null;
    const projects = await this.listCollection(`${config.apiUrl}/projects.json`, config, token, config.maxProjects, 'projects');
    const records = [];
    const pushRecord = (record) => {
      if (record?.id) records.push(record);
    };
    let todoLists = 0;
    let todos = 0;

    for (const project of projects) {
      if (!project?.id || !project?.name) continue;
      const projectRecord = compactObject({
        id: `project:${project.id}`, sourceType: 'project', projectId: project.id, name: project.name,
        status: project.status, createdAt: project.created_at, updatedAt: project.updated_at
      });
      const projectDate = parseDate(projectRecord.updatedAt || projectRecord.createdAt);
      if (!updatedAfter || !projectDate || projectDate >= updatedAfter) pushRecord(projectRecord);

      const todoSet = Array.isArray(project.dock) ? project.dock.find(tool => tool?.name === 'todoset' && tool.enabled !== false && /^\d+$/.test(String(tool.id || ''))) : null;
      if (!todoSet) continue;
      const lists = await this.listCollection(`${config.apiUrl}/buckets/${project.id}/todosets/${todoSet.id}/todolists.json`, config, token, config.maxTodoListsPerProject, 'to-do lists');
      todoLists += lists.length;
      for (const list of lists) {
        if (!list?.id) continue;
        const listTodos = await this.listCollection(`${config.apiUrl}/todolists/${list.id}/todos.json`, config, token, Math.min(config.maxTodosPerList, config.maxTotalTodos - todos), 'to-dos');
        todos += listTodos.length;
        if (todos > config.maxTotalTodos) {
          const error = new Error('Basecamp sync reached its configured total to-do limit. Increase SNEUP_BASECAMP_MAX_TOTAL_TODOS before continuing.');
          error.statusCode = 413;
          throw error;
        }
        for (const todo of listTodos) {
          if (!todo?.id || !(todo.content || todo.title)) continue;
          const todoRecord = compactObject({
            id: `todo:${todo.id}`, sourceType: 'todo', todoId: todo.id, projectId: project.id, todoListId: list.id,
            name: todo.content || todo.title, status: todo.completed ? 'completed' : 'open', dueAt: todo.due_on,
            createdAt: todo.created_at, updatedAt: todo.updated_at, completedAt: todo.completed_at
          });
          const todoDate = parseDate(todoRecord.updatedAt || todoRecord.completedAt || todoRecord.createdAt);
          if (!updatedAfter || !todoDate || todoDate >= updatedAfter) pushRecord(todoRecord);
        }
      }
    }

    const newest = records.reduce((latest, record) => {
      const date = parseDate(record.updatedAt || record.completedAt || record.createdAt);
      return date && (!latest || date > latest) ? date : latest;
    }, cursorDate);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'basecamp_api', projects: projects.length, todoLists, todos,
        contentPolicy: 'project_todo_metadata_only_selected_account'
      }
    };
  }
}

const basecampWorkSignalClient = new BasecampWorkSignalClient();

module.exports = basecampWorkSignalClient;
module.exports.BasecampWorkSignalClient = BasecampWorkSignalClient;
