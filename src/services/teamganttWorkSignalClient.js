const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.teamgantt.com/v1';
const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const parseDate = value => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};
const boundedText = value => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 240) : undefined;
};
const collection = response => Array.isArray(response?.data?.data) ? response.data.data : Array.isArray(response?.data) ? response.data : null;
const error = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });

const project = value => {
  const projectId = String(value?.id || '');
  if (!validId(projectId) || !boundedText(value?.name)) return null;
  const createdAt = parseDate(value?.created_at || value?.createdAt);
  const updatedAt = parseDate(value?.updated_at || value?.updatedAt);
  return compact({
    id: `project:${projectId}`,
    sourceType: 'project',
    projectId,
    name: boundedText(value.name),
    status: boundedText(value.status),
    createdAt: createdAt?.toISOString(),
    updatedAt: updatedAt?.toISOString()
  });
};

const task = (value, projects) => {
  const taskId = String(value?.id || '');
  const projectId = String(value?.project_id || value?.projectId || '');
  const percentComplete = value?.percent_complete ?? value?.percentComplete;
  const parsedPercent = percentComplete === undefined || percentComplete === null || percentComplete === '' ? undefined : Number(percentComplete);
  const startAt = parseDate(value?.start_date || value?.startAt);
  const dueAt = parseDate(value?.end_date || value?.dueAt);
  const createdAt = parseDate(value?.created_at || value?.createdAt);
  const updatedAt = parseDate(value?.updated_at || value?.updatedAt);
  if (!validId(taskId) || !validId(projectId) || !boundedText(value?.name)
    || (percentComplete !== undefined && (!Number.isFinite(parsedPercent) || parsedPercent < 0 || parsedPercent > 100))) return null;
  return compact({
    id: `task:${taskId}`,
    sourceType: 'task',
    taskId,
    projectId,
    parentGroupId: validId(value?.parent_group_id || value?.parentGroupId) ? String(value.parent_group_id || value.parentGroupId) : undefined,
    project: projects.get(projectId),
    name: boundedText(value.name),
    status: boundedText(value.status),
    priority: boundedText(value.priority),
    percentComplete: parsedPercent,
    startAt: startAt?.toISOString(),
    dueAt: dueAt?.toISOString(),
    createdAt: createdAt?.toISOString(),
    updatedAt: updatedAt?.toISOString()
  });
};

class TeamGanttWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig(account) {
    const companyId = String(account?.metadata?.fields?.companyId || '').trim();
    if (!validId(companyId)) throw error('TeamGantt company ID is required. Reconnect this account with the one company Sneup may read.', 400);
    return {
      companyId,
      timeout: clamp(process.env.SNEUP_TEAMGANTT_TIMEOUT_MS, 15000, 1000, 60000),
      maxResponseBytes: clamp(process.env.SNEUP_TEAMGANTT_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000),
      maxProjects: clamp(process.env.SNEUP_TEAMGANTT_MAX_PROJECTS, 100, 1, 500),
      maxTasks: clamp(process.env.SNEUP_TEAMGANTT_MAX_TASKS, 2500, 1, 10000),
      pageSize: clamp(process.env.SNEUP_TEAMGANTT_PAGE_SIZE, 100, 1, 100),
      projectBatchSize: clamp(process.env.SNEUP_TEAMGANTT_PROJECT_BATCH_SIZE, 20, 1, 50),
      cursorLookbackMs: clamp(process.env.SNEUP_TEAMGANTT_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.apiToken || credentials.apiKey || credentials.accessToken;
    if (!token) throw error('TeamGantt API token is missing. Reconnect this account to continue syncing.', 503);
    return token;
  }

  request(config, token, path, params) {
    return this.http.get(`${API_URL}${path}`, {
      params,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'Sneup Digital Project Manager' },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
  }

  async listProjects(config, token) {
    const response = await this.request(config, token, `/companies/${config.companyId}/projects`);
    const values = collection(response);
    if (!values) throw error('TeamGantt returned an invalid project collection. Reconnect this account before syncing again.');
    if (values.length >= config.maxProjects) throw error('TeamGantt sync reached its configured project limit. Increase SNEUP_TEAMGANTT_MAX_PROJECTS before continuing.', 413);
    const records = values.map(project);
    if (records.some(item => !item)) throw error('TeamGantt returned invalid project metadata. Reconnect this account before syncing again.');
    return records;
  }

  async listTasks(config, token, projectIds) {
    const records = [];
    for (let index = 0; index < projectIds.length; index += config.projectBatchSize) {
      const projectBatch = projectIds.slice(index, index + config.projectBatchSize);
      const batchRecords = [];
      let page = 1;
      let expectedTotal;
      while (true) {
        const remaining = config.maxTasks - records.length;
        if (remaining <= 0) throw error('TeamGantt sync reached its configured task limit. Increase SNEUP_TEAMGANTT_MAX_TASKS before continuing.', 413);
        const response = await this.request(config, token, '/tasks', {
          'project_ids[]': projectBatch,
          page,
          per_page: Math.min(config.pageSize, remaining)
        });
        const values = collection(response);
        const total = Number(response?.data?.meta?.total);
        if (!values || !Number.isInteger(total) || total < 0 || values.length > Math.min(config.pageSize, remaining)) {
          throw error('TeamGantt returned an ambiguous task page. Reconnect this account before syncing again.');
        }
        if (expectedTotal === undefined) expectedTotal = total;
        if (total !== expectedTotal || total > remaining) throw error('TeamGantt sync reached its configured task limit. Increase SNEUP_TEAMGANTT_MAX_TASKS before continuing.', 413);
        batchRecords.push(...values);
        if (batchRecords.length > expectedTotal || (batchRecords.length < expectedTotal && values.length === 0)) {
          throw error('TeamGantt returned an incomplete task page. Reconnect this account before syncing again.');
        }
        if (batchRecords.length === expectedTotal) break;
        page += 1;
      }
      records.push(...batchRecords);
    }
    return records;
  }

  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : undefined;
    if (cursor && !cursorDate) throw error('TeamGantt work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const config = this.getConfig(account);
    const token = this.getToken(account);
    const projects = await this.listProjects(config, token);
    const projectMap = new Map(projects.map(item => [item.projectId, { id: item.projectId, name: item.name }]));
    const rawTasks = await this.listTasks(config, token, projects.map(item => item.projectId));
    const tasks = rawTasks.map(item => task(item, projectMap));
    if (tasks.some(item => !item)) throw error('TeamGantt returned invalid task metadata. Reconnect this account before syncing again.');
    const cutoff = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : undefined;
    const records = [...projects, ...tasks].filter(item => !cutoff || !parseDate(item.updatedAt || item.createdAt) || parseDate(item.updatedAt || item.createdAt) >= cutoff);
    const newest = records.reduce((latest, item) => {
      const updated = parseDate(item.updatedAt || item.createdAt);
      return updated && (!latest || updated > latest) ? updated : latest;
    }, cursorDate);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'teamgantt_api',
        companyId: config.companyId,
        projects: projects.length,
        tasks: tasks.length,
        contentPolicy: 'selected_company_project_and_task_metadata_only_with_redacted_titles_no_descriptions_comments_checklists_resources_time_blocks_custom_fields_urls_or_provider_writes'
      }
    };
  }
}

const teamGanttWorkSignalClient = new TeamGanttWorkSignalClient();
module.exports = teamGanttWorkSignalClient;
module.exports.TeamGanttWorkSignalClient = TeamGanttWorkSignalClient;
