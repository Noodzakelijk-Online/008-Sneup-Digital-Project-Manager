const axios = require('axios');
const net = require('net');
const accountConnectorService = require('./accountConnectorService');

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const compactObject = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const isPrivateIpv4 = (hostname) => {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
};
const validId = (value) => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const itemsFrom = (data) => Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];

const sanitizeProject = (project = {}) => validId(project.id) && project.name ? compactObject({
  id: `project:${project.id}`, sourceType: 'project', projectId: project.id, name: project.name, slug: project.slug,
  createdAt: project.created_date, updatedAt: project.modified_date || project.created_date
}) : null;
const sanitizeStory = (story = {}, projects) => validId(story.id) && story.subject ? compactObject({
  id: `user_story:${story.id}`, sourceType: 'user_story', storyId: story.id, reference: story.ref, name: story.subject,
  project: projects.get(String(story.project)), status: story.status, blocked: story.is_blocked === true, closed: story.is_closed === true,
  milestoneId: story.milestone, dueAt: story.due_date, createdAt: story.created_date, updatedAt: story.modified_date || story.created_date
}) : null;
const sanitizeTask = (task = {}, projects) => validId(task.id) && task.subject ? compactObject({
  id: `task:${task.id}`, sourceType: 'task', taskId: task.id, reference: task.ref, name: task.subject,
  project: projects.get(String(task.project)), storyId: task.user_story, status: task.status, blocked: task.is_blocked === true,
  closed: task.is_closed === true, milestoneId: task.milestone, dueAt: task.due_date,
  createdAt: task.created_date, updatedAt: task.modified_date || task.created_date
}) : null;

class TaigaWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig(account) {
    return {
      apiUrl: this.getApiUrl(account), timeout: clampInteger(process.env.SNEUP_TAIGA_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clampInteger(process.env.SNEUP_TAIGA_MAX_PROJECTS, 100, 1, 500),
      maxStories: clampInteger(process.env.SNEUP_TAIGA_MAX_USER_STORIES, 2500, 1, 10000),
      maxTasks: clampInteger(process.env.SNEUP_TAIGA_MAX_TASKS, 2500, 1, 10000),
      pageSize: clampInteger(process.env.SNEUP_TAIGA_PAGE_SIZE, 100, 1, 200),
      cursorLookbackMs: clampInteger(process.env.SNEUP_TAIGA_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getApiUrl(account) {
    const raw = String(account?.metadata?.fields?.baseUrl || '').trim();
    let url;
    try { url = new URL(raw); } catch { url = null; }
    const hostname = url?.hostname?.toLowerCase() || '';
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !hostname
      || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || net.isIP(hostname) === 6 || isPrivateIpv4(hostname)
      || !['/', '/api/v1', '/api/v1/'].includes(url.pathname)) {
      const error = new Error('Taiga base URL must be a public HTTPS site URL, optionally ending in /api/v1, without credentials or a custom port.');
      error.statusCode = 400;
      throw error;
    }
    return `${url.origin}/api/v1`;
  }

  getToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.apiKey || credentials.accessToken;
    if (!token) { const error = new Error('Taiga access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; }
    return token;
  }

  request(config, token, path, params) {
    return this.http.get(`${config.apiUrl}${path}`, {
      ...(params ? { params } : {}), headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      timeout: config.timeout, maxRedirects: 0, proxy: false
    });
  }

  async listCollection(config, token, { path, limit, label, params, sanitize }) {
    const records = []; let fetched = 0; let page = 1;
    while (true) {
      const remaining = limit - fetched;
      if (remaining <= 0) { const error = new Error(`Taiga sync reached its configured ${label} limit. Increase the corresponding SNEUP_TAIGA limit before continuing.`); error.statusCode = 413; throw error; }
      const pageSize = Math.min(config.pageSize, remaining);
      const response = await this.request(config, token, path, { ...params, page, page_size: pageSize });
      const total = Number(response.headers?.['x-pagination-total']);
      if (Number.isFinite(total) && total > limit) { const error = new Error(`Taiga sync reached its configured ${label} limit. Increase the corresponding SNEUP_TAIGA limit before continuing.`); error.statusCode = 413; throw error; }
      const items = itemsFrom(response.data);
      if (items.length > remaining) { const error = new Error(`Taiga returned more ${label} than Sneup is configured to process. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
      fetched += items.length;
      records.push(...items.map(sanitize).filter(Boolean));
      if (items.length < pageSize) return records;
      if (fetched >= limit) { const error = new Error(`Taiga sync reached its configured ${label} limit. Increase the corresponding SNEUP_TAIGA limit before continuing.`); error.statusCode = 413; throw error; }
      page += 1;
    }
  }

  async listProjectCollection(config, token, { path, projects, limit, label, sanitize }) {
    const records = []; let fetched = 0;
    for (const project of projects) {
      let page = 1;
      while (true) {
        const remaining = limit - fetched;
        if (remaining <= 0) { const error = new Error(`Taiga sync reached its configured ${label} limit. Increase the corresponding SNEUP_TAIGA limit before continuing.`); error.statusCode = 413; throw error; }
        const pageSize = Math.min(config.pageSize, remaining);
        const response = await this.request(config, token, path, { project: project.projectId, page, page_size: pageSize });
        const total = Number(response.headers?.['x-pagination-total']);
        if (Number.isFinite(total) && total > remaining) { const error = new Error(`Taiga sync reached its configured ${label} limit. Increase the corresponding SNEUP_TAIGA limit before continuing.`); error.statusCode = 413; throw error; }
        const items = itemsFrom(response.data);
        if (items.length > remaining) { const error = new Error(`Taiga returned more ${label} than Sneup is configured to process. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
        fetched += items.length;
        records.push(...items.map(item => sanitize(item)).filter(Boolean));
        if (items.length < pageSize) break;
        if (fetched >= limit) { const error = new Error(`Taiga sync reached its configured ${label} limit. Increase the corresponding SNEUP_TAIGA limit before continuing.`); error.statusCode = 413; throw error; }
        page += 1;
      }
    }
    return records;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(account); const token = this.getToken(account); const cursorDate = parseDate(cursor);
    const me = await this.request(config, token, '/users/me');
    if (!validId(me.data?.id)) { const error = new Error('Taiga did not return a valid current-user identity. Reconnect this account to continue syncing.'); error.statusCode = 502; throw error; }
    const projects = await this.listCollection(config, token, { path: '/projects', limit: config.maxProjects, label: 'project', params: { member: me.data.id }, sanitize: sanitizeProject });
    const projectMap = new Map(projects.map(project => [String(project.projectId), { id: project.projectId, name: project.name, slug: project.slug }]));
    const stories = await this.listProjectCollection(config, token, { path: '/userstories', projects, limit: config.maxStories, label: 'user story', sanitize: story => sanitizeStory(story, projectMap) });
    const tasks = await this.listProjectCollection(config, token, { path: '/tasks', projects, limit: config.maxTasks, label: 'task', sanitize: task => sanitizeTask(task, projectMap) });
    const records = [...projects, ...stories, ...tasks].filter(record => {
      const updatedAt = parseDate(record.updatedAt || record.createdAt);
      return !cursorDate || !updatedAt || updatedAt >= new Date(cursorDate.getTime() - config.cursorLookbackMs);
    });
    const newest = records.reduce((latest, record) => { const date = parseDate(record.updatedAt || record.createdAt); return date && (!latest || date > latest) ? date : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'taiga_api', projects: projects.length, userStories: stories.length, tasks: tasks.length, contentPolicy: 'project_story_task_metadata_only_no_descriptions_comments_attachments_custom_attributes_or_provider_writes' } };
  }
}

const taigaWorkSignalClient = new TaigaWorkSignalClient();
module.exports = taigaWorkSignalClient;
module.exports.TaigaWorkSignalClient = TaigaWorkSignalClient;
