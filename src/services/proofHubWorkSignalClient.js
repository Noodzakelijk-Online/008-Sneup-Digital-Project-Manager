const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const PROOFHUB_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.proofhub\.com$/;

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

const error = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const parseDate = value => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const boundedText = value => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 160) : undefined;
};
const collection = (response, label) => {
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.data?.data)) return response.data.data;
  throw error(`ProofHub returned an invalid ${label} collection. Reconnect this account before syncing again.`);
};
const updatedAt = item => item.updated_at || item.modified_at || item.created_at || item.completed_at;
const projectRecord = item => validId(item?.id) && boundedText(item.title) ? compact({
  id: `project:${item.id}`,
  sourceType: 'project',
  projectId: item.id,
  name: boundedText(item.title),
  status: item.archived === true ? 'archived' : 'open',
  dueAt: item.end_date,
  createdAt: item.created_at,
  updatedAt: updatedAt(item)
}) : null;
const taskListRecord = (item, projectId) => validId(item?.id) && boundedText(item.title) ? compact({
  id: `task_list:${item.id}`,
  sourceType: 'task_list',
  projectId,
  taskListId: item.id,
  name: boundedText(item.title),
  status: item.archived === true ? 'archived' : 'open',
  createdAt: item.created_at,
  updatedAt: updatedAt(item)
}) : null;
const taskRecord = (item, projectId, taskListId) => validId(item?.id) && boundedText(item.title) ? compact({
  id: `task:${item.id}`,
  sourceType: 'task',
  taskId: item.id,
  projectId,
  taskListId,
  name: boundedText(item.title),
  status: item.completed === true ? 'done' : 'open',
  dueAt: item.due_date,
  createdAt: item.created_at,
  updatedAt: updatedAt(item),
  completedAt: item.completed_at
}) : null;

class ProofHubWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
    this.sleep = options.sleep || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    this.nextRequestAt = new Map();
  }

  getConfig(account) {
    return {
      apiUrl: this.getApiUrl(account),
      timeout: clampInteger(process.env.SNEUP_PROOFHUB_TIMEOUT_MS, 15000, 1000, 60000),
      minIntervalMs: clampInteger(process.env.SNEUP_PROOFHUB_MIN_INTERVAL_MS, 500, 400, 60000),
      maxProjects: clampInteger(process.env.SNEUP_PROOFHUB_MAX_PROJECTS, 100, 1, 500),
      maxTaskLists: clampInteger(process.env.SNEUP_PROOFHUB_MAX_TASK_LISTS, 500, 1, 2500),
      maxTaskListsPerProject: clampInteger(process.env.SNEUP_PROOFHUB_MAX_TASK_LISTS_PER_PROJECT, 100, 1, 500),
      maxTasks: clampInteger(process.env.SNEUP_PROOFHUB_MAX_TASKS, 2500, 1, 10000),
      maxTasksPerList: clampInteger(process.env.SNEUP_PROOFHUB_MAX_TASKS_PER_LIST, 250, 1, 1000),
      maxResponseBytes: clampInteger(process.env.SNEUP_PROOFHUB_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000),
      cursorLookbackMs: clampInteger(process.env.SNEUP_PROOFHUB_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getApiUrl(account) {
    const raw = String(account?.metadata?.fields?.tenantUrl || '').trim();
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw error('ProofHub tenant URL must be an HTTPS URL such as https://your-company.proofhub.com.', 400);
    }
    if (url.protocol !== 'https:' || !PROOFHUB_HOST.test(url.hostname) || url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw error('ProofHub tenant URL must be an HTTPS URL such as https://your-company.proofhub.com.', 400);
    }
    return `${url.origin}/api/v3`;
  }

  getApiKey(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const apiKey = credentials.apiKey || credentials.token || credentials.accessToken;
    if (!apiKey) throw error('ProofHub API key is missing. Reconnect this account to continue syncing.', 503);
    return apiKey;
  }

  async request(config, apiKey, path) {
    const now = Date.now();
    const nextAllowedAt = this.nextRequestAt.get(config.apiUrl) || now;
    const waitMs = Math.max(0, nextAllowedAt - now);
    if (waitMs) await this.sleep(waitMs);
    this.nextRequestAt.set(config.apiUrl, Date.now() + config.minIntervalMs);
    return this.http.get(`${config.apiUrl}${path}`, {
      headers: {
        Accept: 'application/json',
        'X-API-KEY': apiKey,
        'User-Agent': 'Sneup Project Manager (support@noodzakelijk.online)'
      },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: 64 * 1024,
      maxRedirects: 0,
      proxy: false
    });
  }

  normalize(records, sanitize, label) {
    const normalized = records.map(sanitize);
    if (normalized.some(item => !item)) {
      throw error(`ProofHub returned invalid ${label} metadata. Reconnect this account before syncing again.`);
    }
    return normalized;
  }

  withinCursor(records, cursorDate, lookbackMs) {
    if (!cursorDate) return records;
    const since = cursorDate.getTime() - lookbackMs;
    return records.filter(record => {
      const date = parseDate(record.updatedAt || record.createdAt || record.completedAt);
      return !date || date.getTime() >= since;
    });
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(account);
    const apiKey = this.getApiKey(account);
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) throw error('ProofHub work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);

    const projectsRaw = collection(await this.request(config, apiKey, '/projects'), 'project');
    if (projectsRaw.length > config.maxProjects) throw error('ProofHub sync reached its configured project limit. Increase SNEUP_PROOFHUB_MAX_PROJECTS before continuing.', 413);
    const projects = this.normalize(projectsRaw, projectRecord, 'project');
    const taskLists = [];
    const tasks = [];

    for (const project of projectsRaw) {
      if (project.archived === true) continue;
      const projectId = String(project.id);
      const taskListsRaw = collection(await this.request(config, apiKey, `/projects/${encodeURIComponent(projectId)}/todolists`), 'task-list');
      if (taskListsRaw.length > config.maxTaskListsPerProject || taskLists.length + taskListsRaw.length > config.maxTaskLists) {
        throw error('ProofHub sync reached its configured task-list limit. Increase SNEUP_PROOFHUB_MAX_TASK_LISTS before continuing.', 413);
      }
      const publicTaskLists = taskListsRaw.filter(item => item.private !== true && item.archived !== true);
      taskLists.push(...this.normalize(publicTaskLists, item => taskListRecord(item, projectId), 'task-list'));

      for (const taskList of publicTaskLists) {
        const taskListId = String(taskList.id);
        const tasksRaw = collection(await this.request(config, apiKey, `/projects/${encodeURIComponent(projectId)}/todolists/${encodeURIComponent(taskListId)}/tasks`), 'task');
        if (tasksRaw.length > config.maxTasksPerList || tasks.length + tasksRaw.length > config.maxTasks) {
          throw error('ProofHub sync reached its configured task limit. Increase SNEUP_PROOFHUB_MAX_TASKS before continuing.', 413);
        }
        const publicTasks = tasksRaw.filter(item => item.private !== true);
        tasks.push(...this.normalize(publicTasks, item => taskRecord(item, projectId, taskListId), 'task'));
      }
    }

    const allRecords = this.withinCursor([...projects, ...taskLists, ...tasks], cursorDate, config.cursorLookbackMs);
    const newest = allRecords.reduce((latest, record) => {
      const date = parseDate(record.updatedAt || record.createdAt || record.completedAt);
      return date && (!latest || date > latest) ? date : latest;
    }, cursorDate);
    return {
      records: allRecords,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'proofhub_api_v3',
        projects: projects.length,
        taskLists: taskLists.length,
        tasks: tasks.length,
        contentPolicy: 'bounded_project_task_list_task_metadata_only_no_descriptions_comments_files_custom_fields_people_provider_urls_or_writes'
      }
    };
  }
}

const proofHubWorkSignalClient = new ProofHubWorkSignalClient();
module.exports = proofHubWorkSignalClient;
module.exports.ProofHubWorkSignalClient = ProofHubWorkSignalClient;
