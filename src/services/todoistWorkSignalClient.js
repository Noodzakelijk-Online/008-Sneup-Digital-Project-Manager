const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.todoist.com/rest/v2';
const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

class TodoistWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  async fetchDelta(account, cursor) {
    const token = this.accountConnectorService.getAccountCredentials(account).token || this.accountConnectorService.getAccountCredentials(account).accessToken;
    if (!token) { const error = new Error('Todoist personal access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; }
    const maxProjects = clampInteger(process.env.SNEUP_TODOIST_MAX_PROJECTS, 100, 1, 500);
    const maxTasks = clampInteger(process.env.SNEUP_TODOIST_MAX_TASKS, 1000, 1, 5000);
    const request = path => this.http.get(`${API_URL}${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, timeout: clampInteger(process.env.SNEUP_TODOIST_TIMEOUT_MS, 15000, 1000, 60000) });
    const [projectsResponse, tasksResponse] = await Promise.all([request('/projects'), request('/tasks')]);
    const projects = Array.isArray(projectsResponse.data) ? projectsResponse.data : [];
    const tasks = Array.isArray(tasksResponse.data) ? tasksResponse.data : [];
    if (projects.length >= maxProjects || tasks.length >= maxTasks) { const error = new Error('Todoist sync reached its configured project or task limit. Increase SNEUP_TODOIST_MAX_PROJECTS or SNEUP_TODOIST_MAX_TASKS before continuing.'); error.statusCode = 413; throw error; }
    const projectNames = new Map(projects.map(project => [String(project.id), project.name]));
    const records = tasks.map(task => ({ id: task.id, content: task.content, projectId: task.projectId || task.project_id, sectionId: task.sectionId || task.section_id, priority: task.priority, assigneeId: task.assigneeId || task.assignee_id, due: task.due?.datetime || task.due?.date, createdAt: task.createdAt || task.created_at, url: task.url, project: { id: String(task.projectId || task.project_id || ''), name: projectNames.get(String(task.projectId || task.project_id || '')) } }));
    return { records, nextCursor: cursor || null, hasMore: false, metadata: { source: 'todoist_api', projects: projects.length, items: records.length } };
  }
}
const todoistWorkSignalClient = new TodoistWorkSignalClient();
module.exports = todoistWorkSignalClient;
module.exports.TodoistWorkSignalClient = TodoistWorkSignalClient;
