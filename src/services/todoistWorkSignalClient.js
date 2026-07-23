const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.todoist.com/rest/v2';

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

const connectorError = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const opaqueId = value => String(value || '').trim().slice(0, 128) || undefined;

const boundedText = (value) => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 240) : undefined;
};

const isoDate = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const projectRecord = (project) => {
  const id = opaqueId(project?.id);
  const name = boundedText(project?.name);
  return id && name ? { id, name } : null;
};

const taskRecord = (task, projects) => {
  const id = opaqueId(task?.id);
  const content = boundedText(task?.content);
  const projectId = opaqueId(task?.projectId || task?.project_id);
  const sectionId = opaqueId(task?.sectionId || task?.section_id);
  const assigneeId = opaqueId(task?.assigneeId || task?.assignee_id);
  const priority = task?.priority === undefined || task?.priority === null ? undefined : Number(task.priority);
  const dueAt = isoDate(task?.due?.datetime || task?.due?.date);
  const createdAt = isoDate(task?.createdAt || task?.created_at);

  if (!id || !content || (task?.priority !== undefined && (!Number.isInteger(priority) || priority < 1 || priority > 4))
    || ((task?.due?.datetime || task?.due?.date) && !dueAt) || ((task?.createdAt || task?.created_at) && !createdAt)) {
    return null;
  }

  return {
    id,
    content,
    projectId,
    sectionId,
    priority,
    assigneeId,
    due: dueAt,
    createdAt,
    project: projectId ? projects.get(projectId) : undefined
  };
};

class TodoistWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clampInteger(process.env.SNEUP_TODOIST_TIMEOUT_MS, 15000, 1000, 60000),
      maxResponseBytes: clampInteger(process.env.SNEUP_TODOIST_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000),
      maxProjects: clampInteger(process.env.SNEUP_TODOIST_MAX_PROJECTS, 100, 1, 500),
      maxTasks: clampInteger(process.env.SNEUP_TODOIST_MAX_TASKS, 1000, 1, 5000)
    };
  }

  getToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.accessToken || credentials.apiKey;
    if (!token) throw connectorError('Todoist personal access token is missing. Reconnect this account to continue syncing.', 503);
    return token;
  }

  request(config, token, path) {
    return this.http.get(`${API_URL}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getToken(account);
    const [projectsResponse, tasksResponse] = await Promise.all([
      this.request(config, token, '/projects'),
      this.request(config, token, '/tasks')
    ]);
    const projects = projectsResponse?.data;
    const tasks = tasksResponse?.data;
    if (!Array.isArray(projects) || !Array.isArray(tasks)) {
      throw connectorError('Todoist returned an invalid project or task collection. Reconnect this account before syncing again.');
    }
    if (projects.length >= config.maxProjects || tasks.length >= config.maxTasks) {
      throw connectorError('Todoist sync reached its configured project or task limit. Increase SNEUP_TODOIST_MAX_PROJECTS or SNEUP_TODOIST_MAX_TASKS before continuing.', 413);
    }

    const normalizedProjects = projects.map(projectRecord);
    if (normalizedProjects.some(project => !project)) {
      throw connectorError('Todoist returned invalid project metadata. Reconnect this account before syncing again.');
    }
    const projectNames = new Map(normalizedProjects.map(project => [project.id, project]));
    const records = tasks.map(task => taskRecord(task, projectNames));
    if (records.some(record => !record)) {
      throw connectorError('Todoist returned invalid task metadata. Reconnect this account before syncing again.');
    }

    return {
      records,
      nextCursor: cursor || null,
      hasMore: false,
      metadata: {
        source: 'todoist_api',
        projects: normalizedProjects.length,
        items: records.length,
        contentPolicy: 'bounded_project_and_task_metadata_only_with_redacted_titles_no_descriptions_comments_attachments_urls_or_provider_writes'
      }
    };
  }
}

const todoistWorkSignalClient = new TodoistWorkSignalClient();

module.exports = todoistWorkSignalClient;
module.exports.TodoistWorkSignalClient = TodoistWorkSignalClient;
