const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const ZONES = new Map([
  ['eu1', 'https://eu1.make.com/api/v2'],
  ['eu2', 'https://eu2.make.com/api/v2'],
  ['us1', 'https://us1.make.com/api/v2'],
  ['us2', 'https://us2.make.com/api/v2'],
  ['eu1-celonis', 'https://eu1.make.celonis.com/api/v2'],
  ['us1-celonis', 'https://us1.make.celonis.com/api/v2']
]);

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
const numericId = value => /^\d{1,20}$/.test(String(value || '')) ? String(value) : undefined;

const scenarioRecord = item => {
  const scenarioId = numericId(item?.id);
  const name = boundedText(item?.name);
  if (!scenarioId || !name) return null;

  return compact({
    id: `scenario:${scenarioId}`,
    sourceType: 'workflow',
    scenarioId,
    teamId: numericId(item?.teamId),
    folderId: numericId(item?.folderId),
    name,
    status: item.isinvalid ? 'blocked' : item.islocked ? 'waiting' : item.isActive ? 'in_progress' : 'waiting',
    active: Boolean(item.isActive),
    createdAt: item.created,
    updatedAt: item.lastEdit || item.updatedAt || item.created
  });
};

class MakeWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_MAKE_TIMEOUT_MS, 15000, 1000, 60000),
      maxScenarios: clamp(process.env.SNEUP_MAKE_MAX_SCENARIOS, 250, 1, 1000)
    };
  }

  getCredentials(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const apiToken = credentials.apiToken || credentials.apiKey || credentials.token;
    if (!apiToken) {
      const error = new Error('Make API token is missing. Reconnect this account with scenarios:read access.');
      error.statusCode = 503;
      throw error;
    }
    return apiToken;
  }

  getTarget(account) {
    const zone = String(account?.metadata?.fields?.zone || 'eu1').trim().toLowerCase();
    const baseUrl = ZONES.get(zone);
    if (!baseUrl) {
      const error = new Error('Make zone must be one of eu1, eu2, us1, us2, eu1-celonis, or us1-celonis.');
      error.statusCode = 400;
      throw error;
    }
    return { zone, baseUrl };
  }

  getTeamId(account) {
    const teamId = numericId(account?.metadata?.fields?.teamId);
    if (!teamId) {
      const error = new Error('A numeric Make team ID is required to keep scenario sync scoped to one team.');
      error.statusCode = 400;
      throw error;
    }
    return teamId;
  }

  getScenarios(payload) {
    if (!Array.isArray(payload?.scenarios)) {
      const error = new Error('Make scenarios response must contain a scenarios array.');
      error.statusCode = 502;
      throw error;
    }
    return payload.scenarios;
  }

  assertBounded(payload, scenarios, maximum) {
    const total = Number(payload?.pg?.total ?? payload?.pg?.totalCount ?? payload?.pg?.count);
    const hasNextPage = Boolean(payload?.pg?.next || payload?.pg?.nextPage || payload?.pg?.hasNext);
    if (scenarios.length > maximum || (Number.isFinite(total) && total > maximum) || hasNextPage) {
      const error = new Error('Make sync reached its configured scenario limit. Narrow the team scope or increase SNEUP_MAKE_MAX_SCENARIOS before continuing.');
      error.statusCode = 413;
      throw error;
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const apiToken = this.getCredentials(account);
    const { zone, baseUrl } = this.getTarget(account);
    const teamId = this.getTeamId(account);
    const response = await this.http.get(`${baseUrl}/scenarios`, {
      params: {
        teamId,
        'pg[limit]': config.maxScenarios + 1,
        'cols[]': ['id', 'name', 'teamId', 'folderId', 'isActive', 'isinvalid', 'islocked', 'lastEdit', 'created']
      },
      headers: {
        Accept: 'application/json',
        Authorization: `Token ${apiToken}`,
        'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)'
      },
      timeout: config.timeout,
      maxRedirects: 0,
      proxy: false
    });
    const scenarios = this.getScenarios(response.data);
    this.assertBounded(response.data, scenarios, config.maxScenarios);
    const records = scenarios.map(scenarioRecord).filter(Boolean);
    const newest = records.reduce((latest, item) => {
      const updated = parseDate(item.updatedAt || item.createdAt);
      return updated && (!latest || updated > latest) ? updated : latest;
    }, parseDate(cursor));

    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'make_api',
        zone,
        teamId,
        scenarios: records.length,
        contentPolicy: 'bounded_make_scenario_metadata_only_no_blueprints_modules_connections_execution_data_or_provider_writes'
      }
    };
  }
}

const makeWorkSignalClient = new MakeWorkSignalClient();
module.exports = makeWorkSignalClient;
module.exports.MakeWorkSignalClient = MakeWorkSignalClient;
