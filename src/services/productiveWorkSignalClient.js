const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.productive.io/api/v2/projects';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const connectorError = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const safeId = value => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ''));
const safeOrganizationId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const parseDate = value => { if (value === undefined || value === null || value === '') return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const boundedText = value => {
  const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 160) : undefined;
};
const projectRecord = item => {
  const attributes = item?.attributes || {};
  const id = String(item?.id || ''); const name = boundedText(attributes.name);
  const createdAt = parseDate(attributes.created_at || attributes.createdAt); const updatedAt = parseDate(attributes.updated_at || attributes.updatedAt);
  if (item?.type !== 'projects' || !safeId(id) || !name || (attributes.created_at && !createdAt) || (attributes.updated_at && !updatedAt)) return null;
  return compact({ id: `project:${id}`, sourceType: 'project', projectId: id, name, status: attributes.archived === true || attributes.archived_at ? 'archived' : 'open', createdAt: createdAt?.toISOString(), updatedAt: updatedAt?.toISOString() });
};

class ProductiveWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }
  getConfig(account) {
    const organizationId = String(account?.metadata?.fields?.organizationId || '').trim();
    if (!safeOrganizationId(organizationId)) throw connectorError('Productive organization ID is invalid. Reconnect this account to continue syncing.', 400);
    return { organizationId, timeout: clamp(process.env.SNEUP_PRODUCTIVE_TIMEOUT_MS, 15000, 1000, 60000), maxProjects: clamp(process.env.SNEUP_PRODUCTIVE_MAX_PROJECTS, 500, 1, 5000), pageSize: clamp(process.env.SNEUP_PRODUCTIVE_PAGE_SIZE, 100, 1, 100), maxPages: clamp(process.env.SNEUP_PRODUCTIVE_MAX_PAGES, 20, 1, 100), maxResponseBytes: clamp(process.env.SNEUP_PRODUCTIVE_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000), cursorLookbackMs: clamp(process.env.SNEUP_PRODUCTIVE_CURSOR_LOOKBACK_MS, 60000, 0, 3600000) };
  }
  getToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.token || credentials.apiToken || credentials.accessToken; if (!token) throw connectorError('Productive API token is missing. Reconnect this account to continue syncing.', 503); return token; }
  request(config, token, page, pageSize) {
    return this.http.get(API_URL, { params: { 'page[number]': page, 'page[size]': pageSize }, headers: { Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json', 'X-Auth-Token': token, 'X-Organization-Id': config.organizationId }, timeout: config.timeout, maxContentLength: config.maxResponseBytes, maxBodyLength: 64 * 1024, maxRedirects: 0, proxy: false });
  }
  validatePage(body, pageSize, remaining) {
    const records = body?.data;
    if (!Array.isArray(records) || records.length > pageSize || records.length > remaining) throw connectorError('Productive returned an invalid or over-limit project page. Reconnect this account before syncing again.');
    const next = body?.links?.next;
    if (next !== undefined && next !== null && typeof next !== 'string') throw connectorError('Productive returned an invalid project pagination link. Reconnect this account before syncing again.');
    return { records, hasNext: next === undefined ? records.length === pageSize : Boolean(next) };
  }
  async fetchDelta(account, cursor) {
    const priorCursor = cursor ? parseDate(cursor) : null;
    if (cursor && !priorCursor) throw connectorError('Productive work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const config = this.getConfig(account); const token = this.getToken(account); const cutoff = priorCursor ? new Date(priorCursor.getTime() - config.cursorLookbackMs) : null;
    const records = []; let page = 1; let pages = 0; let scanned = 0;
    while (true) {
      if (pages >= config.maxPages) throw connectorError('Productive sync reached its configured page limit. Increase SNEUP_PRODUCTIVE_MAX_PAGES before continuing.', 413);
      const remaining = config.maxProjects - scanned;
      if (remaining <= 0) throw connectorError('Productive sync reached its configured project limit. Increase SNEUP_PRODUCTIVE_MAX_PROJECTS before continuing.', 413);
      const response = await this.request(config, token, page, Math.min(config.pageSize, remaining));
      const result = this.validatePage(response?.data, Math.min(config.pageSize, remaining), remaining);
      const normalized = result.records.map(projectRecord);
      if (normalized.some(item => !item)) throw connectorError('Productive returned invalid project metadata. Reconnect this account before syncing again.');
      records.push(...normalized.filter(item => { const changed = parseDate(item.updatedAt || item.createdAt); return !cutoff || !changed || changed >= cutoff; }));
      scanned += result.records.length; pages += 1;
      if (!result.hasNext) break;
      if (result.records.length === 0) throw connectorError('Productive returned an incomplete project page. Reconnect this account before syncing again.');
      page += 1;
    }
    const newest = records.reduce((latest, item) => { const changed = parseDate(item.updatedAt || item.createdAt); return changed && (!latest || changed > latest) ? changed : latest; }, priorCursor);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'productive_project_metadata', projects: records.length, pages, contentPolicy: 'bounded_project_metadata_only_no_tasks_budgets_resource_plans_time_people_invoices_files_custom_fields_urls_or_provider_writes' } };
  }
}

const productiveWorkSignalClient = new ProductiveWorkSignalClient();
module.exports = productiveWorkSignalClient;
module.exports.ProductiveWorkSignalClient = ProductiveWorkSignalClient;
