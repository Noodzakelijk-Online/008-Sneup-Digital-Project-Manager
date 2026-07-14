const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const PROJECT_FIELDS = 'ID,name,status,priority,percentComplete,plannedStartDate,plannedCompletionDate,lastUpdateDate';

const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const validId = value => /^[A-Za-z0-9]{1,64}$/.test(String(value || ''));
const boundedText = value => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 160) : undefined;
};
const parseDate = value => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const invalidResponse = message => {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
};

const project = value => {
  const projectId = String(value?.ID || '');
  const percentComplete = value?.percentComplete;
  const parsedPercent = percentComplete === undefined || percentComplete === null || percentComplete === '' ? undefined : Number(percentComplete);
  const plannedStartDate = parseDate(value?.plannedStartDate);
  const plannedCompletionDate = parseDate(value?.plannedCompletionDate);
  const updatedAt = parseDate(value?.lastUpdateDate);
  if (!validId(projectId) || !boundedText(value?.name)
    || (percentComplete !== undefined && (!Number.isFinite(parsedPercent) || parsedPercent < 0 || parsedPercent > 100))
    || (value?.plannedStartDate && !plannedStartDate)
    || (value?.plannedCompletionDate && !plannedCompletionDate)
    || (value?.lastUpdateDate && !updatedAt)) return null;
  return compact({
    id: `project:${projectId}`,
    sourceType: 'project',
    projectId,
    name: boundedText(value.name),
    status: boundedText(value.status),
    priority: boundedText(value.priority),
    percentComplete: parsedPercent,
    plannedStartDate: plannedStartDate?.toISOString(),
    plannedCompletionDate: plannedCompletionDate?.toISOString(),
    updatedAt: updatedAt?.toISOString()
  });
};

class WorkfrontWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getApiUrl(account) {
    const raw = String(account?.metadata?.fields?.baseUrl || '').trim();
    let url;
    try {
      url = new URL(raw);
    } catch {
      url = null;
    }
    const hostname = url?.hostname?.toLowerCase() || '';
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !hostname.endsWith('.my.workfront.com')) {
      const error = new Error('Workfront tenant URL must be a public HTTPS *.my.workfront.com URL without credentials, a custom port, path, query, or fragment.');
      error.statusCode = 400;
      throw error;
    }
    return url.origin;
  }

  getConfig(account) {
    return {
      apiUrl: this.getApiUrl(account),
      timeout: clamp(process.env.SNEUP_WORKFRONT_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clamp(process.env.SNEUP_WORKFRONT_MAX_PROJECTS, 250, 1, 1000),
      pageSize: clamp(process.env.SNEUP_WORKFRONT_PAGE_SIZE, 100, 1, 200)
    };
  }

  getToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.accessToken || credentials.apiKey;
    if (!token) {
      const error = new Error('Workfront OAuth session token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) {
      const error = new Error('Workfront work-signal cursor is invalid. Reconnect this account to establish a new cursor.');
      error.statusCode = 400;
      throw error;
    }
    const config = this.getConfig(account);
    const token = this.getToken(account);
    const records = [];
    let first = 0;
    let pages = 0;
    let scanned = 0;
    while (true) {
      const remaining = config.maxProjects - scanned;
      if (remaining <= 0) {
        const error = new Error('Workfront sync reached its configured project limit. Increase SNEUP_WORKFRONT_MAX_PROJECTS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      const limit = Math.min(config.pageSize, remaining);
      const response = await this.http.get(`${config.apiUrl}/attask/api/v15.0/project/search`, {
        params: { fields: PROJECT_FIELDS, '$$FIRST': first, '$$LIMIT': limit, ID_Sort: 'asc' },
        headers: { Accept: 'application/json', SessionID: token, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' },
        timeout: config.timeout,
        maxRedirects: 0,
        proxy: false
      });
      const values = response?.data?.data;
      if (!Array.isArray(values) || values.length > limit) throw invalidResponse('Workfront returned an invalid project-metadata page. Reconnect this account before syncing again.');
      const normalized = values.map(project);
      if (normalized.some(item => !item)) throw invalidResponse('Workfront returned invalid project metadata. Reconnect this account before syncing again.');
      scanned += values.length;
      records.push(...normalized.filter(item => {
        const updatedAt = parseDate(item.updatedAt);
        return !cursorDate || !updatedAt || updatedAt >= cursorDate;
      }));
      pages += 1;
      if (values.length < limit) break;
      if (scanned >= config.maxProjects) {
        const error = new Error('Workfront sync reached its configured project limit before the provider collection ended. Increase SNEUP_WORKFRONT_MAX_PROJECTS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      first += values.length;
    }
    const newest = records.reduce((latest, record) => {
      const date = parseDate(record.updatedAt);
      return date && (!latest || date > latest) ? date : latest;
    }, cursorDate);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'workfront_current_project_metadata',
        projects: records.length,
        pages,
        contentPolicy: 'current_project_metadata_only_no_tasks_issues_people_approvals_proofs_resources_custom_fields_documents_links_descriptions_raw_payloads_or_provider_writes'
      }
    };
  }
}

const workfrontWorkSignalClient = new WorkfrontWorkSignalClient();
module.exports = workfrontWorkSignalClient;
module.exports.WorkfrontWorkSignalClient = WorkfrontWorkSignalClient;
