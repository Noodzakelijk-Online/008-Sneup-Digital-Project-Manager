const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const CLARIZEN_API_ORIGINS = new Set(['https://api.clarizen.com', 'https://apie1.clarizen.com']);
const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const error = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
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
const projectId = value => {
  const match = String(value || '').match(/^(?:\/Project\/)?([A-Za-z0-9_-]{1,128})$/i);
  return match?.[1] || null;
};

const projectRecord = value => {
  const id = projectId(value?.id || value?.Id);
  const startAt = parseDate(value?.startDate || value?.StartDate);
  if (!id || !boundedText(value?.name || value?.Name) || ((value?.startDate || value?.StartDate) && !startAt)) return null;
  return compact({ id: `project:${id}`, sourceType: 'project', projectId: id, name: boundedText(value.name || value.Name), status: 'open', startAt: startAt?.toISOString() });
};

class ClarizenWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig(account) {
    const raw = String(account?.metadata?.fields?.tenantUrl || '').trim();
    let url;
    try { url = new URL(raw); } catch { url = null; }
    if (!url || !CLARIZEN_API_ORIGINS.has(url.origin) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw error('Clarizen API region must be https://api.clarizen.com or https://apie1.clarizen.com without credentials, a custom port, path, query, or fragment.', 400);
    return {
      apiUrl: `${url.origin}/v2.0/services/data/EntityQuery`,
      timeout: clamp(process.env.SNEUP_CLARIZEN_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clamp(process.env.SNEUP_CLARIZEN_MAX_PROJECTS, 1000, 1, 5000),
      pageSize: clamp(process.env.SNEUP_CLARIZEN_PAGE_SIZE, 100, 1, 250),
      maxResponseBytes: clamp(process.env.SNEUP_CLARIZEN_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000)
    };
  }

  getApiKey(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const apiKey = credentials.apiKey || credentials.token || credentials.accessToken;
    if (!apiKey) throw error('Clarizen API key is missing. Reconnect this account to continue syncing.', 503);
    return apiKey;
  }

  request(config, apiKey, from, limit) {
    return this.http.post(config.apiUrl, {
      typeName: 'Project',
      fields: ['Name', 'StartDate'],
      orders: [{ fieldName: 'StartDate', order: 'Ascending' }],
      paging: { From: from, Limit: limit }
    }, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `ApiKey ${apiKey}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: 64 * 1024,
      maxRedirects: 0,
      proxy: false
    });
  }

  async fetchDelta(account, cursor) {
    if (cursor) throw error('Clarizen project sync uses a bounded full project index and does not accept provider cursors. Reconnect this account to establish a new sync state.', 400);
    const config = this.getConfig(account);
    const apiKey = this.getApiKey(account);
    const records = [];
    let scanned = 0;
    let pages = 0;

    while (true) {
      const remaining = config.maxProjects - scanned;
      if (remaining <= 0) throw error('Clarizen sync reached its configured project limit. Increase SNEUP_CLARIZEN_MAX_PROJECTS before continuing.', 413);
      const pageSize = Math.min(config.pageSize, remaining);
      const response = await this.request(config, apiKey, scanned, pageSize);
      const entities = response?.data?.entities;
      if (!Array.isArray(entities) || entities.length > pageSize) throw error('Clarizen returned an invalid or over-limit project metadata page. Reconnect this account before syncing again.');
      const normalized = entities.map(projectRecord);
      if (normalized.some(item => !item)) throw error('Clarizen returned invalid project metadata. Reconnect this account before syncing again.');
      records.push(...normalized);
      scanned += entities.length;
      pages += 1;
      if (entities.length < pageSize) break;
      if (scanned >= config.maxProjects) throw error('Clarizen sync reached its configured project limit before the provider collection ended. Increase SNEUP_CLARIZEN_MAX_PROJECTS before continuing.', 413);
    }

    return { records, nextCursor: null, hasMore: false, metadata: { source: 'clarizen_project_metadata', projects: records.length, pages, contentPolicy: 'bounded_project_name_and_start_date_only_no_tasks_initiatives_assignments_risks_milestones_people_financials_custom_fields_urls_or_provider_writes' } };
  }
}

const clarizenWorkSignalClient = new ClarizenWorkSignalClient();
module.exports = clarizenWorkSignalClient;
module.exports.ClarizenWorkSignalClient = ClarizenWorkSignalClient;
