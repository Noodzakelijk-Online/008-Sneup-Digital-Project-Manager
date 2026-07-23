const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const JIRA_ALIGN_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)?jiraalign\.com$/;
const API_PATH = '/rest/align/api/2';

const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const safeId = value => /^[A-Za-z0-9_-]{1,256}$/.test(String(value || '')) ? String(value) : undefined;
const boundedText = (value, maximum = 160) => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, maximum) : undefined;
};
const parseDate = value => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};
const error = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });

const record = (sourceType, value) => {
  const jiraAlignId = safeId(value?.id);
  const name = boundedText(value?.title);
  const updatedAt = parseDate(value?.lastUpdatedDate);
  if (!jiraAlignId || !name || (value?.lastUpdatedDate && !updatedAt)) return null;
  return compact({
    id: `jira_align_${sourceType}:${jiraAlignId}`,
    sourceType,
    jiraAlignId,
    name,
    updatedAt
  });
};

class JiraAlignWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getApiUrl(account) {
    const raw = String(account?.metadata?.fields?.tenantUrl || '').trim();
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw error('Jira Align tenant URL must be an HTTPS URL such as https://your-company.jiraalign.com.', 400);
    }
    if (url.protocol !== 'https:' || !JIRA_ALIGN_HOST.test(url.hostname.toLowerCase()) || url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw error('Jira Align tenant URL must be an HTTPS URL such as https://your-company.jiraalign.com.', 400);
    }
    return `${url.origin}${API_PATH}`;
  }

  getConfig(account) {
    return {
      apiUrl: this.getApiUrl(account),
      timeout: clamp(process.env.SNEUP_JIRA_ALIGN_TIMEOUT_MS, 15000, 1000, 60000),
      maxPortfolios: clamp(process.env.SNEUP_JIRA_ALIGN_MAX_PORTFOLIOS, 100, 1, 500),
      maxPrograms: clamp(process.env.SNEUP_JIRA_ALIGN_MAX_PROGRAMS, 250, 1, 1000),
      maxResponseBytes: clamp(process.env.SNEUP_JIRA_ALIGN_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000),
      cursorLookbackMs: clamp(process.env.SNEUP_JIRA_ALIGN_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getApiToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const apiToken = credentials.apiToken || credentials.token || credentials.accessToken || credentials.apiKey;
    if (!apiToken) throw error('Jira Align API token is missing. Reconnect this account to continue syncing.', 503);
    return apiToken;
  }

  collection(response, label, maximum) {
    const payload = response?.data;
    const values = Array.isArray(payload) ? payload : payload?.value;
    const nextLink = payload?.['@odata.nextLink'] || payload?.['odata.nextLink'] || payload?.nextLink;
    if (!Array.isArray(values)) throw error(`Jira Align returned an invalid ${label} collection. Reconnect this account before syncing again.`);
    if (values.length > maximum || nextLink) {
      throw error(`Jira Align sync reached an incomplete ${label} page. Increase the matching SNEUP_JIRA_ALIGN_MAX_* limit before continuing.`, 413);
    }
    return values;
  }

  isWithinCursor(item, cursor, lookbackMs) {
    if (!cursor) return true;
    const updated = new Date(item.updatedAt || 0).getTime();
    return !Number.isFinite(updated) || updated >= cursor.getTime() - lookbackMs;
  }

  async request(config, apiToken, endpoint, maximum) {
    const response = await this.http.get(`${config.apiUrl}/${endpoint}`, {
      params: { '$select': 'id,title,lastUpdatedDate', '$top': maximum },
      headers: {
        Accept: 'application/json;odata.metadata=minimal;odata.streaming=true',
        Authorization: `Bearer ${apiToken}`,
        'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)'
      },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
    return this.collection(response, endpoint.toLowerCase(), maximum);
  }

  async fetchDelta(account, cursor) {
    const cursorDate = cursor && !Number.isNaN(new Date(cursor).getTime()) ? new Date(cursor) : null;
    if (cursor && !cursorDate) throw error('Jira Align work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);

    const config = this.getConfig(account);
    const apiToken = this.getApiToken(account);
    const [portfoliosRaw, programsRaw] = await Promise.all([
      this.request(config, apiToken, 'Portfolios', config.maxPortfolios),
      this.request(config, apiToken, 'Programs', config.maxPrograms)
    ]);
    const allRecords = [
      ...portfoliosRaw.map(value => record('portfolio', value)),
      ...programsRaw.map(value => record('program', value))
    ];
    if (allRecords.some(value => !value)) throw error('Jira Align returned invalid portfolio or program metadata. Reconnect this account before syncing again.');
    const records = allRecords.filter(item => this.isWithinCursor(item, cursorDate, config.cursorLookbackMs));
    const newest = records.reduce((latest, item) => {
      const updated = item.updatedAt ? new Date(item.updatedAt) : null;
      return updated && (!latest || updated > latest) ? updated : latest;
    }, cursorDate);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'jira_align_api_v2_portfolio_program_metadata',
        portfolios: portfoliosRaw.length,
        programs: programsRaw.length,
        contentPolicy: 'bounded_portfolio_program_metadata_only_no_expansion_descriptions_people_custom_fields_dependencies_work_items_planning_details_provider_urls_or_writes'
      }
    };
  }
}

const jiraAlignWorkSignalClient = new JiraAlignWorkSignalClient();
module.exports = jiraAlignWorkSignalClient;
module.exports.JiraAlignWorkSignalClient = JiraAlignWorkSignalClient;
