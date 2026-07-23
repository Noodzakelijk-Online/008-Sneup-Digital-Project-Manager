const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.usemotion.com/v1';
const USER_AGENT = 'Sneup Digital Project Manager (https://github.com/Noodzakelijk-Online/008-Sneup-Digital-Project-Manager)';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const safeId = value => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ''));
const safeCursor = value => typeof value === 'string' && /^[\x21-\x7e]{1,512}$/.test(value) ? value : undefined;
const parseDate = value => { const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? date : null; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = value => {
  const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 160) : undefined;
};
const error = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });

const projectRecord = item => {
  const id = String(item?.id || ''); const name = boundedText(item?.name); const createdAt = parseDate(item?.createdTime); const updatedAt = parseDate(item?.updatedTime);
  if (!safeId(id) || !name || (item?.createdTime && !createdAt) || (item?.updatedTime && !updatedAt)) return null;
  return compact({ id: `project:${id}`, sourceType: 'project', projectId: id, name, status: item?.status?.isResolvedStatus === true ? 'done' : 'open', createdAt: createdAt?.toISOString(), updatedAt: updatedAt?.toISOString() });
};

const taskRecord = item => {
  const id = String(item?.id || ''); const name = boundedText(item?.name); const createdAt = parseDate(item?.createdTime); const updatedAt = parseDate(item?.updatedTime); const dueAt = parseDate(item?.dueDate); const scheduledStart = parseDate(item?.scheduledStart); const scheduledEnd = parseDate(item?.scheduledEnd); const duration = Number(item?.duration);
  const assignees = item?.assignees;
  const assigneeIds = assignees === undefined || assignees === null ? [] : Array.isArray(assignees) && assignees.length <= 100 ? [...new Set(assignees.map(assignee => safeId(assignee?.id) ? String(assignee.id) : null))] : null;
  if (!safeId(id) || !name || !assigneeIds || assigneeIds.includes(null) || (item?.createdTime && !createdAt) || (item?.updatedTime && !updatedAt) || (item?.dueDate && !dueAt) || (item?.scheduledStart && !scheduledStart) || (item?.scheduledEnd && !scheduledEnd) || (item?.duration !== undefined && item?.duration !== null && item?.duration !== '' && (!Number.isInteger(duration) || duration < 1 || duration > 10080))) return null;
  const priority = ['ASAP', 'HIGH', 'MEDIUM', 'LOW'].includes(item?.priority) ? item.priority.toLowerCase() : undefined;
  return compact({ id: `task:${id}`, sourceType: 'task', taskId: id, projectId: safeId(item?.project?.id) ? String(item.project.id) : undefined, name, status: item?.completed === true || item?.status?.isResolvedStatus === true ? 'done' : 'open', priority, dueAt: dueAt?.toISOString(), startOn: /^\d{4}-\d{2}-\d{2}$/.test(String(item?.startOn || '')) ? item.startOn : undefined, durationMinutes: Number.isInteger(duration) ? duration : undefined, assigneeIds, scheduledStart: scheduledStart?.toISOString(), scheduledEnd: scheduledEnd?.toISOString(), schedulingIssue: item?.schedulingIssue === true, createdAt: createdAt?.toISOString(), updatedAt: updatedAt?.toISOString() });
};

class MotionWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig() { return { timeout: clamp(process.env.SNEUP_MOTION_TIMEOUT_MS, 15000, 1000, 60000), maxProjects: clamp(process.env.SNEUP_MOTION_MAX_PROJECTS, 500, 1, 5000), maxTasks: clamp(process.env.SNEUP_MOTION_MAX_TASKS, 2500, 1, 10000), maxResponseBytes: clamp(process.env.SNEUP_MOTION_MAX_RESPONSE_BYTES, 1000000, 1024, 10000000), cursorLookbackMs: clamp(process.env.SNEUP_MOTION_CURSOR_LOOKBACK_MS, 60000, 0, 3600000) }; }

  getWorkspaceId(account) {
    const workspaceId = String(account?.metadata?.fields?.workspaceId || '').trim();
    if (!safeId(workspaceId)) throw error('Motion workspace ID is required. Reconnect this account with the workspace Sneup may read.', 400);
    return workspaceId;
  }

  getApiKey(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account); const apiKey = credentials.apiKey || credentials.token || credentials.accessToken;
    if (!apiKey) throw error('Motion API key is missing. Reconnect this account to continue syncing.', 503);
    return apiKey;
  }

  async listPages(path, collectionKey, workspaceId, apiKey, config, limit, normalize) {
    const records = []; const seenCursors = new Set(); let cursor;
    while (true) {
      const response = await this.http.get(`${API_URL}${path}`, {
        params: compact({ workspaceId, cursor }),
        headers: { Accept: 'application/json', 'X-API-Key': apiKey, 'User-Agent': USER_AGENT },
        timeout: config.timeout,
        maxContentLength: config.maxResponseBytes,
        maxBodyLength: config.maxResponseBytes,
        maxRedirects: 0,
        proxy: false
      });
      const items = response.data?.[collectionKey]; const nextCursor = response.data?.meta?.nextCursor;
      if (!Array.isArray(items) || (nextCursor !== undefined && nextCursor !== null && !safeCursor(nextCursor)) || items.length > limit - records.length) throw error(`Motion returned an invalid ${collectionKey} page. Reconnect this account before syncing again.`);
      const normalized = items.map(normalize);
      if (normalized.some(item => !item)) throw error(`Motion returned invalid ${collectionKey} metadata. Reconnect this account before syncing again.`);
      records.push(...normalized);
      if (!nextCursor) return records;
      if (records.length >= limit) throw error(`Motion sync reached its configured ${collectionKey} limit. Increase the corresponding SNEUP_MOTION limit before continuing.`, 413);
      if (seenCursors.has(nextCursor)) throw error(`Motion returned a repeated ${collectionKey} cursor. Reconnect this account before syncing again.`);
      seenCursors.add(nextCursor); cursor = nextCursor;
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const workspaceId = this.getWorkspaceId(account); const apiKey = this.getApiKey(account); const priorCursor = cursor ? parseDate(cursor) : null;
    if (cursor && !priorCursor) throw error('Motion work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const projects = await this.listPages('/projects', 'projects', workspaceId, apiKey, config, config.maxProjects, projectRecord);
    const tasks = await this.listPages('/tasks', 'tasks', workspaceId, apiKey, config, config.maxTasks, taskRecord);
    const cutoff = priorCursor ? new Date(priorCursor.getTime() - config.cursorLookbackMs) : null;
    const records = [...projects, ...tasks].filter(item => { const changed = parseDate(item.updatedAt || item.createdAt); return !cutoff || !changed || changed >= cutoff; });
    const newest = records.reduce((latest, item) => { const changed = parseDate(item.updatedAt || item.createdAt); return changed && (!latest || changed > latest) ? changed : latest; }, priorCursor);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'motion_api', workspaceId, projects: projects.length, tasks: tasks.length, contentPolicy: 'selected_workspace_bounded_project_and_task_metadata_only_opaque_task_assignee_ids_only_for_explicit_capacity_mapping_no_descriptions_creator_or_assignee_names_emails_labels_custom_fields_project_payloads_workspace_profiles_or_provider_writes' } };
  }
}

const motionWorkSignalClient = new MotionWorkSignalClient();
module.exports = motionWorkSignalClient;
module.exports.MotionWorkSignalClient = MotionWorkSignalClient;
