const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const INCIDENT_FIELDS = 'sys_id,number,short_description,state,priority,opened_at,due_date,sys_updated_on';

const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const validId = value => /^[a-f0-9]{32}$/i.test(String(value || ''));
const validNumber = value => /^INC[0-9]{1,12}$/i.test(String(value || ''));
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

const incident = value => {
  const incidentId = String(value?.sys_id || '');
  const number = String(value?.number || '');
  const state = String(value?.state || '');
  const priority = String(value?.priority || '');
  const openedAt = parseDate(value?.opened_at);
  const dueAt = parseDate(value?.due_date);
  const updatedAt = parseDate(value?.sys_updated_on);
  if (!validId(incidentId) || !validNumber(number) || !boundedText(value?.short_description)
    || !/^[0-9]{1,3}$/.test(state) || !/^[0-9]{1,3}$/.test(priority)
    || (value?.opened_at && !openedAt) || (value?.due_date && !dueAt) || (value?.sys_updated_on && !updatedAt)) return null;
  return compact({
    id: `incident:${incidentId}`,
    sourceType: 'incident',
    incidentId,
    number: number.toUpperCase(),
    name: boundedText(value.short_description),
    status: state,
    priority,
    openedAt: openedAt?.toISOString(),
    dueAt: dueAt?.toISOString(),
    updatedAt: updatedAt?.toISOString()
  });
};

class ServiceNowWorkSignalClient {
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
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !hostname.endsWith('.service-now.com')) {
      const error = new Error('ServiceNow instance URL must be a public HTTPS *.service-now.com URL without credentials, a custom port, path, query, or fragment.');
      error.statusCode = 400;
      throw error;
    }
    return url.origin;
  }

  getConfig(account) {
    return {
      apiUrl: this.getApiUrl(account),
      timeout: clamp(process.env.SNEUP_SERVICENOW_TIMEOUT_MS, 15000, 1000, 60000),
      maxIncidents: clamp(process.env.SNEUP_SERVICENOW_MAX_INCIDENTS, 500, 1, 2000),
      pageSize: clamp(process.env.SNEUP_SERVICENOW_PAGE_SIZE, 100, 1, 200)
    };
  }

  getToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.accessToken || credentials.apiKey;
    if (!token) {
      const error = new Error('ServiceNow OAuth access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) {
      const error = new Error('ServiceNow work-signal cursor is invalid. Reconnect this account to establish a new cursor.');
      error.statusCode = 400;
      throw error;
    }
    const config = this.getConfig(account);
    const token = this.getToken(account);
    const records = [];
    let offset = 0;
    let pages = 0;
    let scanned = 0;
    while (true) {
      const remaining = config.maxIncidents - scanned;
      if (remaining <= 0) {
        const error = new Error('ServiceNow sync reached its configured incident limit. Increase SNEUP_SERVICENOW_MAX_INCIDENTS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      const limit = Math.min(config.pageSize, remaining);
      const response = await this.http.get(`${config.apiUrl}/api/now/table/incident`, {
        params: { sysparm_query: 'active=true^ORDERBYsys_updated_on', sysparm_fields: INCIDENT_FIELDS, sysparm_limit: limit, sysparm_offset: offset, sysparm_display_value: 'false', sysparm_exclude_reference_link: 'true' },
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' },
        timeout: config.timeout,
        maxRedirects: 0,
        proxy: false
      });
      const values = response?.data?.result;
      if (!Array.isArray(values) || values.length > limit) throw invalidResponse('ServiceNow returned an invalid incident-metadata page. Reconnect this account before syncing again.');
      const normalized = values.map(incident);
      if (normalized.some(item => !item)) throw invalidResponse('ServiceNow returned invalid incident metadata. Reconnect this account before syncing again.');
      scanned += values.length;
      records.push(...normalized.filter(item => {
        const updatedAt = parseDate(item.updatedAt);
        return !cursorDate || !updatedAt || updatedAt >= cursorDate;
      }));
      pages += 1;
      if (values.length < limit) break;
      if (scanned >= config.maxIncidents) {
        const error = new Error('ServiceNow sync reached its configured incident limit before the provider collection ended. Increase SNEUP_SERVICENOW_MAX_INCIDENTS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      offset += values.length;
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
        source: 'servicenow_active_incident_metadata',
        incidents: records.length,
        pages,
        contentPolicy: 'active_incident_metadata_only_no_full_descriptions_callers_assignees_work_notes_comments_attachments_cmdb_requests_changes_tasks_approvals_links_raw_payloads_or_provider_writes'
      }
    };
  }
}

const serviceNowWorkSignalClient = new ServiceNowWorkSignalClient();
module.exports = serviceNowWorkSignalClient;
module.exports.ServiceNowWorkSignalClient = ServiceNowWorkSignalClient;
