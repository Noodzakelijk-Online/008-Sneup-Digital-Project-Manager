const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const DEFAULT_API_URL = 'https://graph.microsoft.com/v1.0';
const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const sanitizeTask = (task = {}) => (!task.id || !task.title ? null : {
  id: `planner_task:${task.id}`, sourceType: 'task', taskId: task.id, title: task.title, planId: task.planId, bucketId: task.bucketId,
  percentComplete: Number(task.percentComplete), priority: task.priority, assigneeIds: Object.keys(task.assignments || {}),
  dueAt: task.dueDateTime?.dateTime, completedAt: task.completedDateTime?.dateTime, createdAt: task.createdDateTime,
  updatedAt: task.lastModifiedDateTime || task.createdDateTime
});

class MicrosoftPlannerWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig() {
    return {
      apiUrl: String(process.env.SNEUP_MICROSOFT_GRAPH_API_URL || DEFAULT_API_URL).replace(/\/$/, ''),
      timeout: clampInteger(process.env.SNEUP_PLANNER_TIMEOUT_MS, 15000, 1000, 60000),
      maxTasks: clampInteger(process.env.SNEUP_PLANNER_MAX_TASKS, 1000, 1, 5000),
      pageSize: clampInteger(process.env.SNEUP_PLANNER_PAGE_SIZE, 100, 1, 100),
      cursorLookbackMs: clampInteger(process.env.SNEUP_PLANNER_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) { const error = new Error('Microsoft Planner access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; }
    return token;
  }

  request(url, token, config, params) {
    return this.http.get(url, { ...(params ? { params } : {}), headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, timeout: config.timeout, maxRedirects: 0, proxy: false });
  }

  validateNextUrl(raw, config) {
    let url; let base;
    try { url = new URL(raw); base = new URL(config.apiUrl); } catch { url = null; }
    if (!url || !base || url.origin !== base.origin || url.pathname !== `${base.pathname}/me/planner/tasks` || url.username || url.password) {
      const error = new Error('Microsoft Planner returned an untrusted pagination URL.'); error.statusCode = 502; throw error;
    }
    return url.toString();
  }

  isWithinCursor(task, cursorDate, config) {
    if (!cursorDate) return true;
    const updatedAt = parseDate(task.updatedAt || task.createdAt);
    return !updatedAt || updatedAt >= new Date(cursorDate.getTime() - config.cursorLookbackMs);
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const token = this.getAccessToken(account); const cursorDate = parseDate(cursor); const records = []; let fetched = 0;
    let nextUrl = `${config.apiUrl}/me/planner/tasks`; let firstPage = true;
    while (nextUrl) {
      const remaining = config.maxTasks - fetched;
      if (remaining <= 0) { const error = new Error('Microsoft Planner sync reached its configured task limit. Increase SNEUP_PLANNER_MAX_TASKS before continuing.'); error.statusCode = 413; throw error; }
      const response = await this.request(nextUrl, token, config, firstPage ? { '$top': Math.min(config.pageSize, remaining), '$select': 'id,title,planId,bucketId,percentComplete,priority,dueDateTime,completedDateTime,createdDateTime,lastModifiedDateTime,assignments' } : undefined);
      firstPage = false;
      const page = Array.isArray(response.data?.value) ? response.data.value : [];
      if (page.length > remaining) { const error = new Error('Microsoft Planner returned more tasks than Sneup is configured to process. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      fetched += page.length;
      records.push(...page.map(sanitizeTask).filter(Boolean).filter(task => this.isWithinCursor(task, cursorDate, config)));
      const rawNext = response.data?.['@odata.nextLink'];
      if (!rawNext) break;
      if (fetched >= config.maxTasks) { const error = new Error('Microsoft Planner sync reached its configured task limit. Increase SNEUP_PLANNER_MAX_TASKS before continuing.'); error.statusCode = 413; throw error; }
      if (page.length === 0) { const error = new Error('Microsoft Planner returned an incomplete task page. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      nextUrl = this.validateNextUrl(rawNext, config);
    }
    const newest = records.reduce((latest, record) => { const updatedAt = parseDate(record.updatedAt || record.createdAt); return updatedAt && (!latest || updatedAt > latest) ? updatedAt : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'microsoft_planner_graph', tasks: records.length, contentPolicy: 'assigned_task_metadata_only_no_descriptions_checklists_or_attachments' } };
  }
}

const microsoftPlannerWorkSignalClient = new MicrosoftPlannerWorkSignalClient();
module.exports = microsoftPlannerWorkSignalClient;
module.exports.MicrosoftPlannerWorkSignalClient = MicrosoftPlannerWorkSignalClient;
