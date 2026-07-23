const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const PROCORE_API_URL = 'https://api.procore.com/rest/v1.1/projects';

const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = (value, maximum = 160) => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, maximum) : undefined;
};
const safeCompanyId = value => /^\d{1,20}$/.test(String(value || '')) ? String(value) : undefined;
const safeProjectId = value => /^\d{1,20}$/.test(String(value || '')) ? String(value) : undefined;
const parseDate = value => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};
const invalidResponse = message => {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
};

const projectRecord = (project, companyId) => {
  const projectId = safeProjectId(project?.id);
  const name = boundedText(project?.name);
  const createdAt = parseDate(project?.created_at);
  const updatedAt = parseDate(project?.updated_at);
  const startAt = parseDate(project?.actual_start_date || project?.estimated_start_date);
  const dueAt = parseDate(project?.projected_finish_date || project?.estimated_completion_date);
  if (!projectId || !name || (project?.created_at && !createdAt) || (project?.updated_at && !updatedAt) || (project?.actual_start_date && !startAt) || (project?.estimated_start_date && !startAt) || (project?.projected_finish_date && !dueAt) || (project?.estimated_completion_date && !dueAt)) return null;
  return compact({
    id: `project:${projectId}`,
    sourceType: 'project',
    projectId,
    companyId,
    name,
    status: project?.active === false ? 'archived' : 'open',
    startAt,
    dueAt,
    createdAt,
    updatedAt
  });
};

class ProcoreWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_PROCORE_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clamp(process.env.SNEUP_PROCORE_MAX_PROJECTS, 200, 1, 300),
      maxResponseBytes: clamp(process.env.SNEUP_PROCORE_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000),
      cursorLookbackMs: clamp(process.env.SNEUP_PROCORE_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('Procore access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  getCompanyId(account) {
    const companyId = safeCompanyId(account?.metadata?.fields?.procoreCompanyId);
    if (!companyId) {
      const error = new Error('Select one authorized Procore company before syncing.');
      error.statusCode = 400;
      throw error;
    }
    return companyId;
  }

  isWithinCursor(project, cursor, config) {
    if (!cursor) return true;
    const updated = new Date(project.updatedAt || project.createdAt || 0).getTime();
    return !Number.isFinite(updated) || updated >= cursor.getTime() - config.cursorLookbackMs;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const cursorDate = cursor && !Number.isNaN(new Date(cursor).getTime()) ? new Date(cursor) : null;
    if (cursor && !cursorDate) {
      const error = new Error('Procore work-signal cursor is invalid. Reconnect this account to establish a new cursor.');
      error.statusCode = 400;
      throw error;
    }

    const token = this.getAccessToken(account);
    const companyId = this.getCompanyId(account);
    const response = await this.http.get(PROCORE_API_URL, {
      params: { company_id: companyId, page: 1, per_page: config.maxProjects },
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Procore-Company-Id': companyId
      },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
    const values = response?.data;
    if (!Array.isArray(values)) throw invalidResponse('Procore returned an invalid active-project collection. Reconnect this account before syncing again.');
    if (values.length >= config.maxProjects) {
      const error = new Error('Procore sync reached its configured active-project limit. Increase SNEUP_PROCORE_MAX_PROJECTS before continuing.');
      error.statusCode = 413;
      throw error;
    }

    const normalized = values.map(project => projectRecord(project, companyId));
    if (normalized.some(project => !project)) throw invalidResponse('Procore returned invalid project metadata. Reconnect this account before syncing again.');
    const records = normalized.filter(project => this.isWithinCursor(project, cursorDate, config));
    const newest = records.reduce((latest, project) => {
      const updated = new Date(project.updatedAt || project.createdAt || 0);
      return !Number.isNaN(updated.getTime()) && (!latest || updated > latest) ? updated : latest;
    }, cursorDate);

    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'procore_active_project_metadata',
        companySelected: true,
        activeProjects: records.length,
        contentPolicy: 'one_selected_procore_company_active_project_name_status_and_schedule_metadata_only_no_budgets_contracts_rfis_submittals_drawings_people_addresses_descriptions_attachments_urls_or_provider_writes'
      }
    };
  }
}

const procoreWorkSignalClient = new ProcoreWorkSignalClient();
module.exports = procoreWorkSignalClient;
module.exports.ProcoreWorkSignalClient = ProcoreWorkSignalClient;
