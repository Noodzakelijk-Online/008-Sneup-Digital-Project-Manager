const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.newrelic.com/v2/alerts_violations.json';

const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

const compact = value => Object.fromEntries(Object.entries(value)
  .filter(([, item]) => item !== undefined && item !== null && item !== ''));

const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));

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

const hasNextPage = headers => /rel\s*=\s*"?next"?/i.test(String(headers?.link || headers?.Link || ''));

const normalizeViolation = value => {
  const violationId = String(value?.id || '');
  const openedAt = parseDate(value?.opened_at);
  const updatedAt = parseDate(value?.closed_at || value?.opened_at);

  if (!validId(violationId) || !boundedText(value?.label)
    || (value?.opened_at && !openedAt) || (value?.closed_at && !updatedAt)) return null;

  return compact({
    id: `violation:${violationId}`,
    sourceType: 'violation',
    violationId,
    name: boundedText(value.label),
    status: value.closed_at ? 'closed' : 'open',
    priority: boundedText(value.priority),
    openedAt: openedAt?.toISOString(),
    updatedAt: updatedAt?.toISOString(),
  });
};

class NewRelicWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_NEW_RELIC_TIMEOUT_MS, 15000, 1000, 60000),
      maxViolations: clamp(process.env.SNEUP_NEW_RELIC_MAX_OPEN_VIOLATIONS, 500, 1, 2000),
      maxPages: clamp(process.env.SNEUP_NEW_RELIC_MAX_PAGES, 20, 1, 100),
    };
  }

  getToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.accessToken || credentials.apiKey;
    if (!token) {
      const error = new Error('New Relic user API key is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) {
      const error = new Error('New Relic work-signal cursor is invalid. Reconnect this account to establish a new cursor.');
      error.statusCode = 400;
      throw error;
    }

    const config = this.getConfig();
    const token = this.getToken(account);
    const records = [];
    let page = 1;
    let pages = 0;
    let scanned = 0;

    while (true) {
      const remaining = config.maxViolations - scanned;
      if (remaining <= 0) {
        const error = new Error('New Relic sync reached its configured violation limit. Increase SNEUP_NEW_RELIC_MAX_OPEN_VIOLATIONS before continuing.');
        error.statusCode = 413;
        throw error;
      }

      const response = await this.http.get(API_URL, {
        params: { only_open: 'true', page },
        headers: {
          Accept: 'application/json',
          'Api-Key': token,
          'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)',
        },
        timeout: config.timeout,
        maxRedirects: 0,
        proxy: false,
      });
      const values = response?.data?.violations;
      if (!Array.isArray(values)) {
        const error = new Error('New Relic returned an invalid open-violation page. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
      if (values.length > remaining) {
        const error = new Error('New Relic sync reached its configured violation limit. Increase SNEUP_NEW_RELIC_MAX_OPEN_VIOLATIONS before continuing.');
        error.statusCode = 413;
        throw error;
      }

      const normalized = values.map(normalizeViolation);
      if (normalized.some(item => !item)) {
        const error = new Error('New Relic returned invalid violation metadata. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }

      pages += 1;
      scanned += values.length;
      records.push(...normalized.filter(item => {
        const updated = parseDate(item.updatedAt);
        return !cursorDate || !updated || updated >= cursorDate;
      }));

      if (!hasNextPage(response?.headers)) break;
      if (scanned >= config.maxViolations || pages >= config.maxPages) {
        const error = new Error('New Relic sync reached its configured collection limit. Increase the New Relic limits before continuing.');
        error.statusCode = 413;
        throw error;
      }
      page += 1;
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
        source: 'new_relic_open_violation_metadata',
        violations: records.length,
        pages,
        contentPolicy: 'open_violation_metadata_only_no_alert_payloads_condition_details_services_deployments_dashboards_users_links_descriptions_raw_payloads_or_provider_writes',
      },
    };
  }
}

const newRelicWorkSignalClient = new NewRelicWorkSignalClient();

module.exports = newRelicWorkSignalClient;
module.exports.NewRelicWorkSignalClient = NewRelicWorkSignalClient;
