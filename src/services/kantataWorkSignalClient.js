const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.mavenlink.com/api/v1';

const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

const connectorError = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));

const boundedText = (value) => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 160) : undefined;
};

const parseDate = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const statusFrom = (workspace) => {
  const status = String(workspace?.status || workspace?.state || '').toLowerCase();
  if (workspace?.archived === true || /(archive|cancel|delete)/.test(status)) return 'archived';
  if (workspace?.closed === true || /(complete|done|closed)/.test(status)) return 'done';
  if (/(wait|hold|pending|review)/.test(status)) return 'waiting';
  if (/(active|progress|started)/.test(status)) return 'in_progress';
  return 'open';
};

const workspaceRecord = (workspace) => {
  const projectId = String(workspace?.id || '');
  const name = boundedText(workspace?.title || workspace?.name);
  const createdAt = parseDate(workspace?.created_at || workspace?.createdAt);
  const updatedAt = parseDate(workspace?.updated_at || workspace?.updatedAt);
  const startAt = parseDate(workspace?.start_date || workspace?.startAt);
  const dueAt = parseDate(workspace?.due_date || workspace?.dueAt || workspace?.finish_date || workspace?.finishAt);
  if (!validId(projectId) || !name ||
    ((workspace?.created_at || workspace?.createdAt) && !createdAt) ||
    ((workspace?.updated_at || workspace?.updatedAt) && !updatedAt) ||
    ((workspace?.start_date || workspace?.startAt) && !startAt) ||
    ((workspace?.due_date || workspace?.dueAt || workspace?.finish_date || workspace?.finishAt) && !dueAt)) {
    return null;
  }
  return {
    id: `project:${projectId}`,
    sourceType: 'project',
    projectId,
    name,
    status: statusFrom(workspace),
    startAt: startAt?.toISOString(),
    dueAt: dueAt?.toISOString(),
    createdAt: createdAt?.toISOString(),
    updatedAt: updatedAt?.toISOString()
  };
};

const canonicalWorkspaces = (body) => {
  const refs = body?.results;
  const values = body?.workspaces;
  if (!Array.isArray(refs) || !values || typeof values !== 'object' || Array.isArray(values)) return null;
  const records = [];
  for (const reference of refs) {
    if (reference?.key !== 'workspaces' || !validId(reference.id)) return null;
    const workspace = values[String(reference.id)];
    if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace) || String(workspace.id || '') !== String(reference.id)) return null;
    records.push(workspace);
  }
  return records;
};

class KantataWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_KANTATA_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clamp(process.env.SNEUP_KANTATA_MAX_PROJECTS, 250, 1, 2000),
      pageSize: clamp(process.env.SNEUP_KANTATA_PAGE_SIZE, 100, 1, 200),
      maxResponseBytes: clamp(process.env.SNEUP_KANTATA_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000),
      cursorLookbackMs: clamp(process.env.SNEUP_KANTATA_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) throw connectorError('Kantata OX access token is missing. Reconnect this account to continue syncing.', 503);
    return token;
  }

  request(config, token, page, perPage) {
    return this.http.get(`${API_URL}/workspaces.json`, {
      params: { page, per_page: perPage },
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
  }

  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) throw connectorError('Kantata OX work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const cutoff = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : null;
    const records = [];
    let expectedTotal = null;
    let scanned = 0;
    let page = 1;

    while (true) {
      const remaining = config.maxProjects - scanned;
      if (remaining <= 0) throw connectorError('Kantata OX sync reached its configured project limit. Increase SNEUP_KANTATA_MAX_PROJECTS before continuing.', 413);
      const response = await this.request(config, token, page, Math.min(config.pageSize, remaining));
      const workspaces = canonicalWorkspaces(response?.data);
      const reportedTotal = Number(response?.data?.count ?? response?.data?.meta?.count);
      if (!Array.isArray(workspaces) || (Number.isFinite(reportedTotal) && (!Number.isInteger(reportedTotal) || reportedTotal < 0))) {
        throw connectorError('Kantata OX returned an invalid project metadata page. Reconnect this account before syncing again.');
      }
      if (Number.isFinite(reportedTotal)) {
        if (expectedTotal !== null && expectedTotal !== reportedTotal) throw connectorError('Kantata OX returned an inconsistent project count. Reconnect this account before syncing again.');
        expectedTotal = reportedTotal;
        if (expectedTotal > config.maxProjects) throw connectorError('Kantata OX sync reached its configured project limit. Increase SNEUP_KANTATA_MAX_PROJECTS before continuing.', 413);
      }
      if (workspaces.length > remaining || workspaces.length > config.pageSize) throw connectorError('Kantata OX returned an over-limit project metadata page. Reconnect this account before syncing again.');
      const normalized = workspaces.map(workspaceRecord);
      if (normalized.some(record => !record)) throw connectorError('Kantata OX returned invalid project metadata. Reconnect this account before syncing again.');
      scanned += workspaces.length;
      records.push(...normalized.filter(record => {
        const changedAt = parseDate(record.updatedAt || record.createdAt);
        return !cutoff || !changedAt || changedAt >= cutoff;
      }));

      if (expectedTotal !== null && scanned >= expectedTotal) break;
      if (workspaces.length < Math.min(config.pageSize, remaining)) {
        if (expectedTotal !== null && scanned < expectedTotal) throw connectorError('Kantata OX returned an incomplete project metadata page. Reconnect this account before syncing again.');
        break;
      }
      if (scanned >= config.maxProjects) throw connectorError('Kantata OX sync reached its configured project limit before the provider collection ended. Increase SNEUP_KANTATA_MAX_PROJECTS before continuing.', 413);
      page += 1;
    }

    const newest = records.reduce((latest, record) => {
      const changedAt = parseDate(record.updatedAt || record.createdAt);
      return changedAt && (!latest || changedAt > latest) ? changedAt : latest;
    }, cursorDate);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'kantata_ox_workspace_metadata',
        projects: records.length,
        scannedProjects: scanned,
        contentPolicy: 'bounded_project_metadata_only_no_stories_people_schedules_budgets_financials_attachments_comments_custom_fields_urls_or_provider_writes'
      }
    };
  }
}

const kantataWorkSignalClient = new KantataWorkSignalClient();

module.exports = kantataWorkSignalClient;
module.exports.KantataWorkSignalClient = KantataWorkSignalClient;
