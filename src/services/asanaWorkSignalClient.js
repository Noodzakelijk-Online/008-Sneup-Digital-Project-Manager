const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const DEFAULT_API_URL = 'https://app.asana.com/api/1.0';
const DEFAULT_MAX_PROJECTS = 25;
const DEFAULT_MAX_TASKS_PER_PROJECT = 250;
const DEFAULT_MAX_TOTAL_TASKS = 2500;
const DEFAULT_CURSOR_LOOKBACK_MS = 60000;

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

const parseCursor = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

class AsanaWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
    this.now = options.now || (() => new Date());
  }

  getConfig() {
    return {
      apiUrl: String(process.env.SNEUP_ASANA_API_URL || DEFAULT_API_URL).replace(/\/$/, ''),
      timeout: clampInteger(process.env.SNEUP_ASANA_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clampInteger(process.env.SNEUP_ASANA_MAX_PROJECTS, DEFAULT_MAX_PROJECTS, 1, 100),
      maxTasksPerProject: clampInteger(process.env.SNEUP_ASANA_MAX_TASKS_PER_PROJECT, DEFAULT_MAX_TASKS_PER_PROJECT, 1, 1000),
      maxTotalTasks: clampInteger(process.env.SNEUP_ASANA_MAX_TOTAL_TASKS, DEFAULT_MAX_TOTAL_TASKS, 1, 10000),
      cursorLookbackMs: clampInteger(process.env.SNEUP_ASANA_CURSOR_LOOKBACK_MS, DEFAULT_CURSOR_LOOKBACK_MS, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('Asana access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  getWorkspaceGid(account) {
    return String(account?.metadata?.fields?.asanaWorkspaceGid || '').trim();
  }

  request(path, token, config, params = {}) {
    return this.http.get(`${config.apiUrl}${path}`, {
      params,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      },
      timeout: config.timeout
    });
  }

  async listWorkspaces(token, config) {
    const response = await this.request('/workspaces', token, config, {
      limit: 100,
      opt_fields: 'gid,name,is_organization'
    });
    return Array.isArray(response.data?.data) ? response.data.data : [];
  }

  selectWorkspace(account, workspaces) {
    const requestedWorkspaceGid = this.getWorkspaceGid(account);
    if (requestedWorkspaceGid) {
      const selected = workspaces.find(workspace => String(workspace.gid || workspace.id) === requestedWorkspaceGid);
      if (!selected) {
        const error = new Error('The selected Asana workspace is no longer available to this account. Reconnect or select an authorized workspace.');
        error.statusCode = 403;
        throw error;
      }
      return selected;
    }

    if (workspaces.length === 1) return workspaces[0];
    if (workspaces.length === 0) {
      const error = new Error('No Asana workspaces are available to this account. Reconnect with workspaces:read access.');
      error.statusCode = 403;
      throw error;
    }

    const error = new Error('This Asana account can access multiple workspaces. Select one before syncing so Sneup does not ingest unrelated work.');
    error.statusCode = 409;
    throw error;
  }

  async listProjects(workspace, token, config) {
    const projects = [];
    let offset;
    do {
      const response = await this.request(`/workspaces/${encodeURIComponent(workspace.gid || workspace.id)}/projects`, token, config, {
        limit: Math.min(100, config.maxProjects - projects.length),
        ...(offset ? { offset } : {}),
        opt_fields: 'gid,name,permalink_url,modified_at'
      });
      const page = Array.isArray(response.data?.data) ? response.data.data : [];
      projects.push(...page);
      offset = response.data?.next_page?.offset;
      if (projects.length >= config.maxProjects && offset) {
        const error = new Error('Asana sync reached its configured project limit. Increase SNEUP_ASANA_MAX_PROJECTS before continuing.');
        error.statusCode = 413;
        throw error;
      }
    } while (offset);
    return projects;
  }

  async listProjectTasks(project, workspace, token, cursorDate, config) {
    const tasks = [];
    let offset;
    const since = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs).toISOString() : null;
    const completedSince = since || this.now().toISOString();
    do {
      const response = await this.request(`/projects/${encodeURIComponent(project.gid || project.id)}/tasks`, token, config, {
        limit: Math.min(100, config.maxTasksPerProject - tasks.length),
        ...(offset ? { offset } : {}),
        ...(since ? { modified_since: since } : {}),
        completed_since: completedSince,
        opt_fields: 'gid,name,notes,completed,completed_at,created_at,modified_at,due_at,due_on,assignee.gid,assignee.name,tags.gid,tags.name,permalink_url,memberships.project.gid,memberships.project.name,memberships.section.gid,memberships.section.name,dependencies.gid,dependents.gid'
      });
      const page = Array.isArray(response.data?.data) ? response.data.data : [];
      tasks.push(...page.map(task => ({
        ...task,
        project: { gid: project.gid || project.id, name: project.name, url: project.permalink_url },
        workspace: { gid: workspace.gid || workspace.id, name: workspace.name }
      })));
      offset = response.data?.next_page?.offset;
      if (tasks.length >= config.maxTasksPerProject && offset) {
        const error = new Error(`Asana project ${project.name || project.gid || project.id} reached its configured task limit. Increase SNEUP_ASANA_MAX_TASKS_PER_PROJECT before continuing.`);
        error.statusCode = 413;
        throw error;
      }
    } while (offset);
    return tasks;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const cursorDate = parseCursor(cursor);
    const workspaces = await this.listWorkspaces(token, config);
    const workspace = this.selectWorkspace(account, workspaces);
    const projects = await this.listProjects(workspace, token, config);
    const recordsByGid = new Map();
    let newest = cursorDate;

    for (const project of projects) {
      const tasks = await this.listProjectTasks(project, workspace, token, cursorDate, config);
      for (const task of tasks) {
        if (recordsByGid.size >= config.maxTotalTasks && !recordsByGid.has(String(task.gid || task.id))) {
          const error = new Error('Asana sync reached its configured total-task limit. Increase SNEUP_ASANA_MAX_TOTAL_TASKS before continuing.');
          error.statusCode = 413;
          throw error;
        }
        const updatedAt = parseCursor(task.modified_at || task.updated_at);
        if (updatedAt && (!newest || updatedAt > newest)) newest = updatedAt;
        recordsByGid.set(String(task.gid || task.id), task);
      }
    }

    return {
      records: Array.from(recordsByGid.values()),
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'asana_api',
        workspaces: 1,
        projects: projects.length,
        workspaceGid: String(workspace.gid || workspace.id)
      }
    };
  }
}

const asanaWorkSignalClient = new AsanaWorkSignalClient();

module.exports = asanaWorkSignalClient;
module.exports.AsanaWorkSignalClient = AsanaWorkSignalClient;
