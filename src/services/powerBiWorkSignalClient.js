const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.powerbi.com/v1.0/myorg/reports';
const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const clean = value => String(value || '')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
  .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 160);
const safeId = value => /^[A-Za-z0-9-]{1,64}$/.test(String(value || '')) ? String(value) : undefined;
const safeReportType = value => /^(?:PowerBIReport|PaginatedReport)$/i.test(String(value || '')) ? String(value) : undefined;
const invalidResponse = message => {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
};

class PowerBiWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_POWER_BI_TIMEOUT_MS, 15000, 1000, 60000),
      maxReports: clamp(process.env.SNEUP_POWER_BI_MAX_REPORTS, 100, 1, 500),
      maxResponseBytes: clamp(process.env.SNEUP_POWER_BI_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('Power BI access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  normalizeReport(report) {
    const reportId = safeId(report?.id);
    if (!reportId) return null;
    return {
      id: `power_bi_report:${reportId}`,
      sourceType: 'report',
      reportId,
      name: clean(report?.name) || `Power BI report ${reportId}`,
      reportType: safeReportType(report?.reportType),
      status: 'open'
    };
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    if (cursor && !/^\d{4}-\d{2}-\d{2}T/.test(String(cursor))) {
      const error = new Error('Power BI work-signal cursor is invalid. Reconnect this account to establish a new cursor.');
      error.statusCode = 400;
      throw error;
    }
    const response = await this.http.get(API_URL, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${this.getAccessToken(account)}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
    const values = response?.data?.value;
    if (!Array.isArray(values)) throw invalidResponse('Power BI returned an invalid report collection. Reconnect this account before syncing again.');
    if (values.length > config.maxReports) {
      const error = new Error('Power BI sync reached its configured report limit. Increase SNEUP_POWER_BI_MAX_REPORTS before continuing.');
      error.statusCode = 413;
      throw error;
    }
    const records = values.map(report => this.normalizeReport(report)).filter(Boolean);
    return {
      records,
      nextCursor: cursor || null,
      hasMore: false,
      metadata: {
        source: 'power_bi_report_catalog_metadata',
        reports: records.length,
        contentPolicy: 'bounded_power_bi_report_catalog_metadata_only_no_report_content_dashboards_datasets_workspaces_descriptions_urls_embeds_owners_subscriptions_users_or_provider_writes'
      }
    };
  }
}

const powerBiWorkSignalClient = new PowerBiWorkSignalClient();
module.exports = powerBiWorkSignalClient;
module.exports.PowerBiWorkSignalClient = PowerBiWorkSignalClient;
