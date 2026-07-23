const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const HIVE_API_URL = 'https://app.hive.com/api/v2';
const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const error = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const safeId = value => /^[A-Za-z0-9_-]{1,128}$/.test(String(value || ''));
const safePageCursor = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001F\u007F]/.test(value);
const boundedText = value => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 160) : undefined;
};
const parseDate = value => {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const statusFrom = value => {
  const text = boundedText(typeof value === 'object' ? value?.name || value?.title : value);
  const normalized = String(text || '').toLowerCase();
  if (/(complete|done|closed)/.test(normalized)) return 'done';
  if (/(progress|active|started)/.test(normalized)) return 'in_progress';
  if (/(wait|hold|review|pending)/.test(normalized)) return 'waiting';
  if (/(archive|cancel|delete)/.test(normalized)) return 'archived';
  return 'open';
};

const projectRecord = value => {
  const projectId = String(value?.id || value?.projectId || value?.project_id || '');
  const createdAt = parseDate(value?.createdAt || value?.created_at);
  const updatedAt = parseDate(value?.modifiedAt || value?.modified_at || value?.updatedAt || value?.updated_at);
  if (!safeId(projectId) || !boundedText(value?.name || value?.title) || ((value?.createdAt || value?.created_at) && !createdAt) || ((value?.modifiedAt || value?.modified_at || value?.updatedAt || value?.updated_at) && !updatedAt)) return null;
  return compact({
    id: `project:${projectId}`,
    sourceType: 'project',
    projectId,
    name: boundedText(value.name || value.title),
    status: value.archived === true || value.isArchived === true ? 'archived' : statusFrom(value.status || value.projectStatus || value.project_status),
    createdAt: createdAt?.toISOString(),
    updatedAt: updatedAt?.toISOString()
  });
};

const projectValues = body => {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.projects)) return body.projects;
  if (Array.isArray(body?.data?.projects)) return body.data.projects;
  return null;
};

const providerPage = body => {
  const page = body?.pageInfo || body?.page_info || body?.pagination || body?.paging || body?.meta?.pageInfo || body?.meta?.pagination || {};
  const hasMore = page.hasNextPage ?? page.has_next_page ?? page.hasMore ?? page.has_more;
  const nextCursor = page.nextCursor ?? page.next_cursor ?? page.endCursor ?? page.end_cursor ?? null;
  if (hasMore !== undefined && typeof hasMore !== 'boolean') return null;
  if (nextCursor !== null && !safePageCursor(nextCursor)) return null;
  return { hasMore: hasMore === true || (hasMore === undefined && Boolean(nextCursor)), nextCursor };
};

class HiveWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig(account) {
    const workspaceId = String(account?.metadata?.fields?.workspaceId || '').trim();
    const userId = String(account?.metadata?.fields?.userId || '').trim();
    if (!safeId(workspaceId) || !safeId(userId)) throw error('Hive workspace ID or user ID is invalid. Reconnect this account to continue syncing.', 400);
    return {
      workspaceId,
      userId,
      timeout: clamp(process.env.SNEUP_HIVE_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clamp(process.env.SNEUP_HIVE_MAX_PROJECTS, 1000, 1, 5000),
      pageSize: clamp(process.env.SNEUP_HIVE_PAGE_SIZE, 100, 1, 250),
      maxPages: clamp(process.env.SNEUP_HIVE_MAX_PAGES, 100, 1, 250),
      maxResponseBytes: clamp(process.env.SNEUP_HIVE_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000),
      cursorLookbackMs: clamp(process.env.SNEUP_HIVE_CURSOR_LOOKBACK_MS, 60000, 0, 24 * 60 * 60 * 1000)
    };
  }

  getApiKey(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const apiKey = credentials.apiKey || credentials.apiToken || credentials.token || credentials.accessToken;
    if (!apiKey) throw error('Hive API key is missing. Reconnect this account to continue syncing.', 503);
    return apiKey;
  }

  request(config, apiKey, cursor, first) {
    return this.http.get(`${HIVE_API_URL}/workspaces/${config.workspaceId}/projects`, {
      params: compact({ user_id: config.userId, first, after: cursor, 'filters[archived]': false, sortBy: 'modifiedAt asc' }),
      headers: { Accept: 'application/json', api_key: apiKey },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: 64 * 1024,
      maxRedirects: 0,
      proxy: false
    });
  }

  async fetchDelta(account, cursor) {
    const priorCursor = cursor ? parseDate(cursor) : null;
    if (cursor && !priorCursor) throw error('Hive work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const config = this.getConfig(account);
    const apiKey = this.getApiKey(account);
    const cutoff = priorCursor ? new Date(priorCursor.getTime() - config.cursorLookbackMs) : null;
    const records = [];
    const seenCursors = new Set();
    let pageCursor;
    let pages = 0;
    let scanned = 0;

    while (true) {
      if (pages >= config.maxPages) throw error('Hive sync reached its configured page limit. Increase SNEUP_HIVE_MAX_PAGES before continuing.', 413);
      const remaining = config.maxProjects - scanned;
      if (remaining <= 0) throw error('Hive sync reached its configured project limit. Increase SNEUP_HIVE_MAX_PROJECTS before continuing.', 413);
      const response = await this.request(config, apiKey, pageCursor, Math.min(config.pageSize, remaining));
      const values = projectValues(response?.data);
      const page = providerPage(response?.data);
      if (!Array.isArray(values) || !page || values.length > remaining || values.length > config.pageSize) throw error('Hive returned an invalid or over-limit project metadata page. Reconnect this account before syncing again.');
      const normalized = values.map(projectRecord);
      if (normalized.some(item => !item)) throw error('Hive returned invalid project metadata. Reconnect this account before syncing again.');
      scanned += values.length;
      records.push(...normalized.filter(item => { const updatedAt = parseDate(item.updatedAt || item.createdAt); return !cutoff || !updatedAt || updatedAt >= cutoff; }));
      pages += 1;
      if (!page.hasMore) {
        if (values.length === config.pageSize && !page.nextCursor) throw error('Hive omitted a required pagination cursor. Reconnect this account before syncing again.');
        break;
      }
      if (!page.nextCursor || values.length === 0 || seenCursors.has(page.nextCursor)) throw error('Hive returned an incomplete or cyclic project metadata page. Reconnect this account before syncing again.');
      seenCursors.add(page.nextCursor);
      pageCursor = page.nextCursor;
    }

    const newest = records.reduce((latest, record) => {
      const date = parseDate(record.updatedAt || record.createdAt);
      return date && (!latest || date > latest) ? date : latest;
    }, priorCursor);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'hive_project_metadata',
        projects: records.length,
        pages,
        contentPolicy: 'bounded_project_metadata_only_no_actions_tasks_conversations_checklists_files_people_custom_fields_urls_or_provider_writes'
      }
    };
  }
}

const hiveWorkSignalClient = new HiveWorkSignalClient();
module.exports = hiveWorkSignalClient;
module.exports.HiveWorkSignalClient = HiveWorkSignalClient;
