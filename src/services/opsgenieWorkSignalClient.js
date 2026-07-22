const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URLS = {
  us: 'https://api.opsgenie.com/v2',
  eu: 'https://api.eu.opsgenie.com/v2'
};

const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const parseDate = value => {
  const parsed = new Date(value);
  return value && !Number.isNaN(parsed.getTime()) ? parsed : null;
};
const boundedText = (value, maximum = 160) => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, maximum) : undefined;
};
const validAlertId = value => /^[A-Za-z0-9-]{8,128}$/.test(String(value || ''));
const validTinyId = value => /^\d{1,20}$/.test(String(value || ''));

const alert = item => {
  if (!validAlertId(item?.id)) return null;
  const status = String(item.status || '').toLowerCase();
  if (!['open', 'closed'].includes(status)) return null;
  return compact({
    id: `alert:${item.id}`,
    sourceType: 'alert',
    alertId: item.id,
    tinyId: validTinyId(item.tinyId) ? String(item.tinyId) : undefined,
    name: boundedText(item.message, 120) || `Opsgenie alert ${validTinyId(item.tinyId) ? item.tinyId : String(item.id).slice(0, 8)}`,
    status,
    priority: ['P1', 'P2', 'P3', 'P4', 'P5'].includes(item.priority) ? item.priority : undefined,
    occurrenceCount: Number.isInteger(Number(item.count)) && Number(item.count) >= 0 && Number(item.count) <= 1000000000 ? Number(item.count) : undefined,
    createdAt: parseDate(item.createdAt)?.toISOString(),
    updatedAt: parseDate(item.updatedAt)?.toISOString(),
    lastOccurredAt: parseDate(item.lastOccurredAt)?.toISOString()
  });
};

class OpsgenieWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_OPSGENIE_TIMEOUT_MS, 15000, 1000, 60000),
      maxAlerts: clamp(process.env.SNEUP_OPSGENIE_MAX_ALERTS, 100, 1, 100),
      maxResponseBytes: clamp(process.env.SNEUP_OPSGENIE_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000)
    };
  }

  getToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.apiKey || credentials.token || credentials.accessToken;
    if (!token) {
      const error = new Error('Opsgenie API key is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  getApiUrl(account) {
    const region = String(account?.metadata?.fields?.region || '').trim().toLowerCase();
    const apiUrl = API_URLS[region];
    if (!apiUrl) {
      const error = new Error('Opsgenie region is required and must be either us or eu.');
      error.statusCode = 400;
      throw error;
    }
    return { region, apiUrl };
  }

  validateCursor(cursor) {
    if (cursor === undefined || cursor === null || cursor === '') return null;
    const parsed = parseDate(cursor);
    if (!parsed) {
      const error = new Error('Opsgenie cursor must be a valid timestamp.');
      error.statusCode = 400;
      throw error;
    }
    return parsed;
  }

  requestConfig(token, config, params) {
    return {
      params,
      headers: {
        Accept: 'application/json',
        Authorization: `GenieKey ${token}`,
        'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)'
      },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    };
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getToken(account);
    const { region, apiUrl } = this.getApiUrl(account);
    const cursorDate = this.validateCursor(cursor);
    const query = 'status: open';

    const countResponse = await this.http.get(`${apiUrl}/alerts/count`, this.requestConfig(token, config, { query }));
    const count = Number(countResponse.data?.data?.count);
    if (!Number.isInteger(count) || count < 0 || count > 20000) {
      const error = new Error('Opsgenie returned an invalid open-alert count. Reconnect this account before syncing again.');
      error.statusCode = 502;
      throw error;
    }
    if (count > config.maxAlerts) {
      const error = new Error('Opsgenie sync reached its configured open-alert limit. Increase SNEUP_OPSGENIE_MAX_ALERTS before continuing.');
      error.statusCode = 413;
      throw error;
    }

    const response = await this.http.get(`${apiUrl}/alerts`, this.requestConfig(token, config, {
      query,
      offset: 0,
      limit: config.maxAlerts,
      sort: 'updatedAt',
      order: 'desc'
    }));
    if (!Array.isArray(response.data?.data) || response.data.data.length !== count || response.data.data.length > config.maxAlerts) {
      const error = new Error('Opsgenie returned an incomplete open-alert collection. Reconnect this account before syncing again.');
      error.statusCode = 502;
      throw error;
    }

    const records = response.data.data.map(alert).filter(Boolean);
    const newest = records.reduce((latest, item) => {
      const updated = parseDate(item.updatedAt || item.lastOccurredAt || item.createdAt);
      return updated && (!latest || updated > latest) ? updated : latest;
    }, cursorDate);

    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'opsgenie_api',
        region,
        openAlerts: records.length,
        contentPolicy: 'open_alert_metadata_only_no_descriptions_aliases_responders_owners_teams_schedules_escalation_policies_incidents_or_provider_writes'
      }
    };
  }
}

const opsgenieWorkSignalClient = new OpsgenieWorkSignalClient();
module.exports = opsgenieWorkSignalClient;
module.exports.OpsgenieWorkSignalClient = OpsgenieWorkSignalClient;
