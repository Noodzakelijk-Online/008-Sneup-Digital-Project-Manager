const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

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
const validId = value => /^[A-Za-z0-9-]{1,128}$/.test(String(value || ''));
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

const asCollection = (payload, container, item) => {
  const values = payload?.[container]?.[item];
  if (Array.isArray(values)) return values;
  if (values && typeof values === 'object') return [values];
  if (values === undefined) return [];
  throw invalidResponse(`Tableau returned an invalid ${container} collection. Reconnect this account before syncing again.`);
};

const paginationTotal = (payload, label) => {
  const value = payload?.pagination?.totalAvailable;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw invalidResponse(`Tableau returned invalid ${label} pagination metadata. Reconnect this account before syncing again.`);
  return parsed;
};

const projectRecord = item => {
  const projectId = String(item?.id || '');
  const name = boundedText(item?.name);
  const createdAt = parseDate(item?.createdAt);
  const updatedAt = parseDate(item?.updatedAt);
  if (!validId(projectId) || !name || (item?.createdAt && !createdAt) || (item?.updatedAt && !updatedAt)) return null;
  return compact({
    id: `project:${projectId}`,
    sourceType: 'project',
    projectId,
    name,
    status: 'open',
    createdAt: createdAt?.toISOString(),
    updatedAt: updatedAt?.toISOString()
  });
};

const workbookRecord = item => {
  const workbookId = String(item?.id || '');
  const name = boundedText(item?.name);
  const projectId = String(item?.project?.id || '');
  const projectName = boundedText(item?.project?.name);
  const createdAt = parseDate(item?.createdAt);
  const updatedAt = parseDate(item?.updatedAt);
  if (!validId(workbookId) || !name || !validId(projectId) || !projectName || (item?.createdAt && !createdAt) || (item?.updatedAt && !updatedAt)) return null;
  return compact({
    id: `workbook:${workbookId}`,
    sourceType: 'workbook',
    workbookId,
    projectId,
    projectName,
    name,
    status: 'open',
    createdAt: createdAt?.toISOString(),
    updatedAt: updatedAt?.toISOString()
  });
};

class TableauWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig(account) {
    const rawBaseUrl = String(account?.metadata?.fields?.baseUrl || '').trim();
    let baseUrl;
    try { baseUrl = new URL(rawBaseUrl); } catch { baseUrl = null; }
    const hostname = baseUrl?.hostname?.toLowerCase() || '';
    if (!baseUrl || baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.port || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash || !/^[a-z0-9-]+\.online\.tableau\.com$/.test(hostname)) {
      const error = new Error('Tableau Cloud requires an HTTPS pod URL such as https://10ay.online.tableau.com, without credentials, a port, path, query, or fragment.');
      error.statusCode = 400;
      throw error;
    }
    const siteContentUrl = String(account?.metadata?.fields?.siteContentUrl || '').trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(siteContentUrl)) {
      const error = new Error('A Tableau Cloud site content URL containing only letters, numbers, underscores, or hyphens is required.');
      error.statusCode = 400;
      throw error;
    }
    const apiVersion = String(process.env.SNEUP_TABLEAU_API_VERSION || '3.29').trim();
    if (!/^\d+\.\d+$/.test(apiVersion)) {
      const error = new Error('SNEUP_TABLEAU_API_VERSION must use a Tableau REST version such as 3.29.');
      error.statusCode = 503;
      throw error;
    }
    return {
      apiUrl: baseUrl.origin,
      siteContentUrl,
      apiVersion,
      timeout: clamp(process.env.SNEUP_TABLEAU_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clamp(process.env.SNEUP_TABLEAU_MAX_PROJECTS, 250, 1, 1000),
      maxWorkbooks: clamp(process.env.SNEUP_TABLEAU_MAX_WORKBOOKS, 500, 1, 1000),
      pageSize: clamp(process.env.SNEUP_TABLEAU_PAGE_SIZE, 100, 1, 1000)
    };
  }

  getCredentials(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const personalAccessTokenName = String(credentials.personalAccessTokenName || '').trim();
    const personalAccessTokenSecret = credentials.personalAccessTokenSecret;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(personalAccessTokenName) || !personalAccessTokenSecret) {
      const error = new Error('A Tableau personal access token name and secret are required. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return { personalAccessTokenName, personalAccessTokenSecret };
  }

  requestOptions(config, token) {
    return {
      headers: {
        Accept: 'application/json',
        ...(token ? { 'X-Tableau-Auth': token } : {})
      },
      timeout: config.timeout,
      maxRedirects: 0,
      proxy: false
    };
  }

  async signIn(config, credentials) {
    const response = await this.http.post(`${config.apiUrl}/api/${config.apiVersion}/auth/signin`, {
      credentials: {
        personalAccessTokenName: credentials.personalAccessTokenName,
        personalAccessTokenSecret: credentials.personalAccessTokenSecret,
        site: { contentUrl: config.siteContentUrl }
      }
    }, {
      ...this.requestOptions(config),
      headers: { ...this.requestOptions(config).headers, 'Content-Type': 'application/json' }
    });
    const token = response?.data?.credentials?.token;
    const siteId = response?.data?.credentials?.site?.id;
    if (typeof token !== 'string' || token.length < 16 || !validId(siteId)) {
      throw invalidResponse('Tableau sign-in response was incomplete. Reconnect this account before syncing again.');
    }
    return { token, siteId };
  }

  async getCollection(config, session, collection, maximum) {
    const response = await this.http.get(`${config.apiUrl}/api/${config.apiVersion}/sites/${session.siteId}/${collection}`, {
      ...this.requestOptions(config, session.token),
      params: { pageSize: Math.min(config.pageSize, maximum), pageNumber: 1 }
    });
    const values = asCollection(response?.data, collection, collection === 'projects' ? 'project' : 'workbook');
    const total = paginationTotal(response?.data, collection);
    if (values.length > maximum || total > maximum || values.length > Math.min(config.pageSize, maximum)) {
      const error = new Error(`Tableau ${collection} exceed the configured collection limit. Increase the relevant SNEUP_TABLEAU_MAX_* setting before continuing.`);
      error.statusCode = 413;
      throw error;
    }
    return values;
  }

  async signOut(config, token) {
    try {
      await this.http.delete(`${config.apiUrl}/api/${config.apiVersion}/auth/signout`, this.requestOptions(config, token));
    } catch {
      // Sign-out is best-effort cleanup after a completed read; it never changes Tableau content.
    }
  }

  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) {
      const error = new Error('Tableau work-signal cursor is invalid. Reconnect this account to establish a new cursor.');
      error.statusCode = 400;
      throw error;
    }
    const config = this.getConfig(account);
    const credentials = this.getCredentials(account);
    const session = await this.signIn(config, credentials);
    try {
      const [projects, workbooks] = await Promise.all([
        this.getCollection(config, session, 'projects', config.maxProjects),
        this.getCollection(config, session, 'workbooks', config.maxWorkbooks)
      ]);
      const normalized = [...projects.map(projectRecord), ...workbooks.map(workbookRecord)];
      if (normalized.some(item => !item)) throw invalidResponse('Tableau returned invalid project or workbook metadata. Reconnect this account before syncing again.');
      const records = normalized.filter(item => {
        const updatedAt = parseDate(item.updatedAt || item.createdAt);
        return !cursorDate || !updatedAt || updatedAt >= cursorDate;
      });
      const newest = records.reduce((latest, record) => {
        const date = parseDate(record.updatedAt || record.createdAt);
        return date && (!latest || date > latest) ? date : latest;
      }, cursorDate);
      return {
        records,
        nextCursor: newest ? newest.toISOString() : cursor || null,
        hasMore: false,
        metadata: {
          source: 'tableau_cloud_project_workbook_metadata',
          projects: projects.length,
          workbooks: workbooks.length,
          contentPolicy: 'bounded_tableau_cloud_project_and_workbook_metadata_only_no_descriptions_views_dashboards_data_sources_owners_permissions_urls_tags_content_or_provider_content_writes'
        }
      };
    } finally {
      await this.signOut(config, session.token);
    }
  }
}

const tableauWorkSignalClient = new TableauWorkSignalClient();
module.exports = tableauWorkSignalClient;
module.exports.TableauWorkSignalClient = TableauWorkSignalClient;
