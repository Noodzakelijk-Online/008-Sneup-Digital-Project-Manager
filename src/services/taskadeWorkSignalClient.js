const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://www.taskade.com/api/v1';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const safeId = value => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ''));
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
  const id = String(item?.id || ''); const name = boundedText(item?.name);
  return safeId(id) && name ? { id: `project:${id}`, sourceType: 'project', projectId: id, name, status: 'open' } : null;
};

const taskRecord = (item, projectId) => {
  const id = String(item?.id || ''); const name = boundedText(item?.text);
  if (!safeId(id) || !name || (item?.completed !== undefined && typeof item.completed !== 'boolean')) return null;
  return { id: `task:${id}`, sourceType: 'task', taskId: id, projectId, name, status: item.completed === true ? 'done' : 'open' };
};

class TaskadeWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_TASKADE_TIMEOUT_MS, 15000, 1000, 60000),
      maxFolders: clamp(process.env.SNEUP_TASKADE_MAX_FOLDERS, 50, 0, 500),
      maxProjects: clamp(process.env.SNEUP_TASKADE_MAX_PROJECTS, 100, 1, 1000),
      maxTasks: clamp(process.env.SNEUP_TASKADE_MAX_TASKS, 2500, 1, 10000),
      pageSize: clamp(process.env.SNEUP_TASKADE_PAGE_SIZE, 100, 1, 100),
      maxResponseBytes: clamp(process.env.SNEUP_TASKADE_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000)
    };
  }

  getWorkspaceId(account) {
    const workspaceId = String(account?.metadata?.fields?.workspaceId || '').trim();
    if (!safeId(workspaceId)) throw error('Taskade workspace ID is required. Reconnect this account with the workspace Sneup may read.', 400);
    return workspaceId;
  }

  getToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.accessToken || credentials.apiKey;
    if (!token) throw error('Taskade personal access token is missing. Reconnect this account to continue syncing.', 503);
    return token;
  }

  async request(config, token, path, params) {
    const response = await this.http.get(`${API_URL}${path}`, {
      params: compact(params || {}),
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
    if (response?.data?.ok !== true || !Array.isArray(response.data.items)) throw error('Taskade returned an invalid collection response. Reconnect this account before syncing again.');
    return response.data.items;
  }

  async listProjects(config, token, workspaceId) {
    const homeProjects = await this.request(config, token, `/folders/${encodeURIComponent(workspaceId)}/projects`);
    const folders = await this.request(config, token, `/workspaces/${encodeURIComponent(workspaceId)}/folders`);
    if (folders.length > config.maxFolders) throw error('Taskade sync reached its configured folder limit. Increase SNEUP_TASKADE_MAX_FOLDERS before continuing.', 413);
    const folderIds = folders.map(folder => safeId(folder?.id) ? String(folder.id) : null);
    if (folderIds.includes(null)) throw error('Taskade returned invalid folder metadata. Reconnect this account before syncing again.');
    const byId = new Map();
    const addProjects = items => {
      for (const item of items) {
        const normalized = projectRecord(item);
        if (!normalized) throw error('Taskade returned invalid project metadata. Reconnect this account before syncing again.');
        byId.set(normalized.projectId, normalized);
        if (byId.size > config.maxProjects) throw error('Taskade sync reached its configured project limit. Increase SNEUP_TASKADE_MAX_PROJECTS before continuing.', 413);
      }
    };
    addProjects(homeProjects);
    for (const folderId of folderIds) addProjects(await this.request(config, token, `/folders/${encodeURIComponent(folderId)}/projects`));
    return [...byId.values()];
  }

  async listProjectTasks(config, token, project) {
    const records = []; let after;
    while (true) {
      const items = await this.request(config, token, `/projects/${encodeURIComponent(project.projectId)}/tasks`, { limit: config.pageSize, after });
      if (items.length > config.pageSize || items.length > config.maxTasks - records.length) throw error('Taskade sync reached its configured task limit. Increase SNEUP_TASKADE_MAX_TASKS before continuing.', 413);
      const normalized = items.map(item => taskRecord(item, project.projectId));
      if (normalized.some(item => !item)) throw error('Taskade returned invalid task metadata. Reconnect this account before syncing again.');
      records.push(...normalized);
      if (items.length < config.pageSize) return records;
      const next = String(items.at(-1)?.id || '');
      if (!safeId(next) || next === after) throw error('Taskade returned a non-progressing task page. Reconnect this account before syncing again.');
      after = next;
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const workspaceId = this.getWorkspaceId(account); const token = this.getToken(account);
    if (cursor && !parseDate(cursor)) throw error('Taskade work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const projects = await this.listProjects(config, token, workspaceId);
    const tasks = [];
    for (const project of projects) {
      const projectTasks = await this.listProjectTasks(config, token, project);
      if (tasks.length + projectTasks.length > config.maxTasks) throw error('Taskade sync reached its configured task limit. Increase SNEUP_TASKADE_MAX_TASKS before continuing.', 413);
      tasks.push(...projectTasks);
    }
    const syncedAt = new Date().toISOString();
    return { records: [...projects, ...tasks], nextCursor: syncedAt, hasMore: false, metadata: { source: 'taskade_api', workspaceId, projects: projects.length, tasks: tasks.length, contentPolicy: 'selected_workspace_bounded_project_and_task_metadata_only_no_descriptions_notes_comments_files_people_parent_task_ids_provider_urls_or_writes' } };
  }
}

const taskadeWorkSignalClient = new TaskadeWorkSignalClient();
module.exports = taskadeWorkSignalClient;
module.exports.TaskadeWorkSignalClient = TaskadeWorkSignalClient;
