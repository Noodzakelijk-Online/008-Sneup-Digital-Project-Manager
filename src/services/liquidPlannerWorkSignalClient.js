const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_ORIGIN = 'https://next.liquidplanner.com/api';

const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const connectorError = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const safeNumericId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
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
const projectRecord = (item, workspaceId) => {
  const projectId = String(item?.id || '');
  const createdAt = parseDate(item?.createdAt);
  const updatedAt = parseDate(item?.updatedAt);
  const startAt = parseDate(item?.targetStart || item?.expectedStart);
  const dueAt = parseDate(item?.targetFinish || item?.expectedFinish);
  if (!safeNumericId(projectId) || item?.itemType !== 'projects' || !boundedText(item?.name)
    || (item?.createdAt && !createdAt) || (item?.updatedAt && !updatedAt)
    || (item?.targetStart && !startAt) || (item?.expectedStart && !startAt)
    || (item?.targetFinish && !dueAt) || (item?.expectedFinish && !dueAt)) return null;
  return compact({
    id: `project:${projectId}`,
    sourceType: 'project',
    projectId,
    workspaceId,
    name: boundedText(item.name),
    status: item.folderStatus === 'onHold' ? 'waiting' : item.folderStatus === 'done' ? 'done' : 'open',
    startAt: startAt?.toISOString(),
    dueAt: dueAt?.toISOString(),
    createdAt: createdAt?.toISOString(),
    updatedAt: updatedAt?.toISOString()
  });
};

class LiquidPlannerWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig(account) {
    const workspaceId = String(account?.metadata?.fields?.workspaceId || '').trim();
    if (!safeNumericId(workspaceId)) {
      throw connectorError('LiquidPlanner workspace ID is invalid. Reconnect this account to continue syncing.', 400);
    }
    return {
      workspaceId,
      timeout: clamp(process.env.SNEUP_LIQUIDPLANNER_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clamp(process.env.SNEUP_LIQUIDPLANNER_MAX_PROJECTS, 500, 1, 5000),
      pageSize: clamp(process.env.SNEUP_LIQUIDPLANNER_PAGE_SIZE, 250, 1, 500),
      maxPages: clamp(process.env.SNEUP_LIQUIDPLANNER_MAX_PAGES, 20, 1, 100),
      maxResponseBytes: clamp(process.env.SNEUP_LIQUIDPLANNER_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000),
      cursorLookbackMs: clamp(process.env.SNEUP_LIQUIDPLANNER_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.apiToken || credentials.apiKey || credentials.accessToken;
    if (!token) throw connectorError('LiquidPlanner API token is missing. Reconnect this account to continue syncing.', 503);
    return token;
  }

  request(config, token, continuationToken, updatedAfter, limit) {
    return this.http.get(`${API_ORIGIN}/workspaces/${config.workspaceId}/items/v1`, {
      params: compact({
        limit,
        'itemType[is]': 'projects',
        'folderStatus[is]': 'active',
        continuationToken,
        'updatedAt[after]': updatedAfter
      }),
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: 64 * 1024,
      maxRedirects: 0,
      proxy: false
    });
  }

  validatePage(body, requestedLimit, remaining) {
    const records = body?.data;
    const recordCount = Number(body?.recordCount);
    const recordLimit = Number(body?.recordLimit);
    const continuationToken = body?.continuationToken;
    if (!Array.isArray(records) || !Number.isInteger(recordCount) || recordCount !== records.length
      || !Number.isInteger(recordLimit) || recordLimit < records.length || recordLimit > requestedLimit
      || records.length > remaining) {
      throw connectorError('LiquidPlanner returned an invalid or over-limit project metadata page. Reconnect this account before syncing again.');
    }
    if (continuationToken !== undefined && continuationToken !== null && continuationToken !== '' && !safeNumericId(continuationToken)) {
      throw connectorError('LiquidPlanner returned an invalid project continuation token. Reconnect this account before syncing again.');
    }
    return { records, continuationToken: continuationToken ? String(continuationToken) : null };
  }

  async fetchDelta(account, cursor) {
    const priorCursor = cursor ? parseDate(cursor) : null;
    if (cursor && !priorCursor) throw connectorError('LiquidPlanner work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const config = this.getConfig(account);
    const token = this.getToken(account);
    const updatedAfter = priorCursor ? new Date(priorCursor.getTime() - config.cursorLookbackMs).toISOString() : null;
    const records = [];
    const seenTokens = new Set();
    let continuationToken;
    let pages = 0;
    let scanned = 0;

    while (true) {
      if (pages >= config.maxPages) throw connectorError('LiquidPlanner sync reached its configured page limit. Increase SNEUP_LIQUIDPLANNER_MAX_PAGES before continuing.', 413);
      const remaining = config.maxProjects - scanned;
      if (remaining <= 0) throw connectorError('LiquidPlanner sync reached its configured project limit. Increase SNEUP_LIQUIDPLANNER_MAX_PROJECTS before continuing.', 413);
      const pageLimit = Math.min(config.pageSize, remaining);
      const response = await this.request(config, token, continuationToken, updatedAfter, pageLimit);
      const page = this.validatePage(response?.data, pageLimit, remaining);
      const normalized = page.records.map(item => projectRecord(item, config.workspaceId));
      if (normalized.some(item => !item)) throw connectorError('LiquidPlanner returned invalid active-project metadata. Reconnect this account before syncing again.');
      records.push(...normalized);
      scanned += page.records.length;
      pages += 1;
      if (!page.continuationToken) break;
      if (page.records.length === 0 || seenTokens.has(page.continuationToken)) {
        throw connectorError('LiquidPlanner returned an incomplete or cyclic project metadata page. Reconnect this account before syncing again.');
      }
      seenTokens.add(page.continuationToken);
      continuationToken = page.continuationToken;
    }

    const newest = records.reduce((latest, record) => {
      const updatedAt = parseDate(record.updatedAt || record.createdAt);
      return updatedAt && (!latest || updatedAt > latest) ? updatedAt : latest;
    }, priorCursor);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'liquidplanner_active_project_metadata',
        projects: records.length,
        pages,
        contentPolicy: 'bounded_active_project_metadata_only_no_tasks_assignments_descriptions_dependencies_time_entries_estimates_resources_files_custom_fields_urls_or_provider_writes'
      }
    };
  }
}

const liquidPlannerWorkSignalClient = new LiquidPlannerWorkSignalClient();
module.exports = liquidPlannerWorkSignalClient;
module.exports.LiquidPlannerWorkSignalClient = LiquidPlannerWorkSignalClient;
