const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const PLANE_API_URL = 'https://api.plane.so/api/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKSPACE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
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
const error = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });

const projectRecord = value => {
  const id = String(value?.id || '');
  const name = boundedText(value?.name);
  const createdAt = parseDate(value?.created_at);
  const updatedAt = parseDate(value?.updated_at);
  if (!UUID.test(id) || !name || (value?.created_at && !createdAt) || (value?.updated_at && !updatedAt)) return null;
  return compact({ id: `project:${id}`, sourceType: 'project', projectId: id, name, status: 'open', createdAt: createdAt?.toISOString(), updatedAt: updatedAt?.toISOString() });
};

const workItemStatus = value => ({ backlog: 'open', unstarted: 'open', started: 'in_progress', completed: 'done', cancelled: 'archived', canceled: 'archived' }[String(value || '').trim().toLowerCase()] || 'open');
const workItemRecord = (value, projectId) => {
  const id = String(value?.id || '');
  const name = boundedText(value?.name);
  const stateGroup = boundedText(value?.state?.group || value?.state_group);
  const priority = String(value?.priority || '').trim().toLowerCase();
  const createdAt = parseDate(value?.created_at);
  const updatedAt = parseDate(value?.updated_at);
  const dueAt = parseDate(value?.target_date || value?.due_date);
  const completedAt = parseDate(value?.completed_at);
  if (!UUID.test(id) || !UUID.test(projectId) || !name || (value?.created_at && !createdAt) || (value?.updated_at && !updatedAt) || ((value?.target_date || value?.due_date) && !dueAt) || (value?.completed_at && !completedAt)) return null;
  return compact({ id: `work_item:${id}`, sourceType: 'work_item', workItemId: id, projectId, name, status: workItemStatus(stateGroup), priority: ['urgent', 'high', 'medium', 'low'].includes(priority) ? priority : 'unknown', dueAt: dueAt?.toISOString(), createdAt: createdAt?.toISOString(), updatedAt: updatedAt?.toISOString(), completedAt: completedAt?.toISOString() });
};

class PlaneWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig(account) {
    const workspaceSlug = String(account?.metadata?.fields?.workspaceSlug || '').trim().toLowerCase();
    if (!WORKSPACE_SLUG.test(workspaceSlug)) throw error('Plane workspace slug is invalid. Reconnect this account with the workspace slug from its Plane URL.', 400);
    return {
      workspaceSlug,
      timeout: clamp(process.env.SNEUP_PLANE_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clamp(process.env.SNEUP_PLANE_MAX_PROJECTS, 20, 1, 100),
      maxWorkItems: clamp(process.env.SNEUP_PLANE_MAX_WORK_ITEMS, 2500, 1, 5000),
      pageSize: clamp(process.env.SNEUP_PLANE_PAGE_SIZE, 100, 1, 100),
      maxResponseBytes: clamp(process.env.SNEUP_PLANE_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000),
      cursorLookbackMs: clamp(process.env.SNEUP_PLANE_CURSOR_LOOKBACK_MS, 60000, 0, 24 * 60 * 60 * 1000)
    };
  }

  getApiKey(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const apiKey = credentials.apiKey || credentials.token || credentials.accessToken;
    if (!apiKey) throw error('Plane API key is missing. Reconnect this account to continue syncing.', 503);
    return apiKey;
  }

  request(path, config, apiKey, params) {
    return this.http.get(`${PLANE_API_URL}${path}`, {
      params,
      timeout: config.timeout,
      headers: { Accept: 'application/json', 'X-API-Key': apiKey },
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: 64 * 1024,
      maxRedirects: 0,
      proxy: false
    });
  }

  async listCollection({ path, config, apiKey, limit, fields, expand, transform, label }) {
    const records = [];
    let cursor;
    let pages = 0;
    while (true) {
      const remaining = limit - records.length;
      if (remaining <= 0) throw error(`Plane sync reached its configured ${label} limit. Increase the corresponding SNEUP_PLANE limit before continuing.`, 413);
      const response = await this.request(path, config, apiKey, { per_page: Math.min(config.pageSize, remaining), fields, ...(expand ? { expand } : {}), ...(cursor ? { cursor } : {}) });
      const data = response?.data;
      const values = data?.results;
      if (!data || !Array.isArray(values) || typeof data.next_page_results !== 'boolean') throw error('Plane returned an invalid metadata page. Reconnect this account before syncing again.');
      if (Number.isFinite(data.total_results) && data.total_results > remaining) throw error(`Plane sync reached its configured ${label} limit. Increase the corresponding SNEUP_PLANE limit before continuing.`, 413);
      if (values.length > remaining) throw error('Plane returned an over-limit metadata page. Reconnect this account before syncing again.');
      const normalized = values.map(transform);
      if (normalized.some(item => !item)) throw error('Plane returned invalid project or work-item metadata. Reconnect this account before syncing again.');
      records.push(...normalized);
      pages += 1;
      if (!data.next_page_results) return { records, pages };
      if (!data.next_cursor || typeof data.next_cursor !== 'string' || values.length === 0) throw error('Plane returned an incomplete metadata page. Reconnect this account before syncing again.');
      if (records.length >= limit) throw error(`Plane sync reached its configured ${label} limit before the provider collection ended. Increase the corresponding SNEUP_PLANE limit before continuing.`, 413);
      cursor = data.next_cursor;
    }
  }

  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) throw error('Plane work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const config = this.getConfig(account);
    const apiKey = this.getApiKey(account);
    const lookback = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : null;
    const projectPath = `/workspaces/${encodeURIComponent(config.workspaceSlug)}/projects/`;
    const projects = await this.listCollection({ path: projectPath, config, apiKey, limit: config.maxProjects, fields: 'id,name,created_at,updated_at', transform: projectRecord, label: 'project' });
    const workItems = [];
    let workItemPages = 0;
    for (let index = 0; index < projects.records.length; index += 1) {
      const project = projects.records[index];
      const remaining = config.maxWorkItems - workItems.length;
      if (remaining <= 0) throw error('Plane sync reached its configured work-item limit before every project could be checked. Increase SNEUP_PLANE_MAX_WORK_ITEMS before continuing.', 413);
      const collection = await this.listCollection({ path: `${projectPath}${encodeURIComponent(project.projectId)}/work-items/`, config, apiKey, limit: remaining, fields: 'id,name,priority,state,created_at,updated_at,target_date,completed_at', expand: 'state', transform: value => workItemRecord(value, project.projectId), label: 'work-item' });
      workItems.push(...collection.records);
      workItemPages += collection.pages;
      if (workItems.length >= config.maxWorkItems && index < projects.records.length - 1) throw error('Plane sync reached its configured work-item limit before every project could be checked. Increase SNEUP_PLANE_MAX_WORK_ITEMS before continuing.', 413);
    }
    const records = [...projects.records, ...workItems].filter(record => {
      const updatedAt = parseDate(record.updatedAt || record.createdAt || record.completedAt);
      return !lookback || !updatedAt || updatedAt >= lookback;
    });
    const newest = records.reduce((latest, record) => {
      const date = parseDate(record.updatedAt || record.createdAt || record.completedAt);
      return date && (!latest || date > latest) ? date : latest;
    }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'plane_project_work_item_metadata', projects: projects.records.length, workItems: workItems.length, pages: projects.pages + workItemPages, contentPolicy: 'bounded_project_and_work_item_metadata_only_no_descriptions_assignees_labels_comments_attachments_custom_fields_urls_or_provider_writes' } };
  }
}

const planeWorkSignalClient = new PlaneWorkSignalClient();
module.exports = planeWorkSignalClient;
module.exports.PlaneWorkSignalClient = PlaneWorkSignalClient;
