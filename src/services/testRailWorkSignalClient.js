const axios = require('axios');
const dns = require('dns');
const https = require('https');
const net = require('net');
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
const numericId = value => /^\d{1,20}$/.test(String(value || '')) ? String(value) : undefined;
const dateFromSeconds = value => {
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric) ? new Date(numeric * 1000) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const privateAddress = (value) => {
  const family = net.isIP(value);
  const address = String(value || '').toLowerCase();
  if (family === 4) {
    const octets = address.split('.').map(Number);
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && (octets[1] === 0 || octets[1] === 168 || octets[1] === 2)) || (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19 || octets[1] === 51)) || (octets[0] === 203 && octets[1] === 0 && octets[2] === 113) || octets[0] >= 224;
  }
  if (family === 6) {
    if (address === '::' || address === '::1' || address.startsWith('fc') || address.startsWith('fd') || /^fe[89ab]/.test(address)) return true;
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return Boolean(mapped && privateAddress(mapped[1]));
  }
  return true;
};

const runRecord = item => {
  const runId = numericId(item?.id);
  const name = boundedText(item?.name);
  if (!runId || !name) return null;
  const blocked = Number(item.blocked_count) || 0;
  const failed = Number(item.failed_count) || 0;
  const status = item.is_completed ? 'done' : blocked > 0 || failed > 0 ? 'blocked' : 'in_progress';

  return compact({
    id: `run:${runId}`,
    sourceType: 'test_run',
    runId,
    projectId: numericId(item.project_id),
    name,
    status,
    priority: failed > 0 ? 'high' : blocked > 0 ? 'normal' : 'unknown',
    dueAt: item.due_on ? dateFromSeconds(item.due_on)?.toISOString() : undefined,
    createdAt: item.created_on ? dateFromSeconds(item.created_on)?.toISOString() : undefined,
    updatedAt: item.updated_on ? dateFromSeconds(item.updated_on)?.toISOString() : undefined,
    completedAt: item.completed_on ? dateFromSeconds(item.completed_on)?.toISOString() : undefined,
    passedCount: Number(item.passed_count) || 0,
    failedCount: failed,
    blockedCount: blocked,
    untestedCount: Number(item.untested_count) || 0,
    completed: Boolean(item.is_completed)
  });
};

class TestRailWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
    this.resolve4 = options.resolve4 || dns.promises.resolve4;
    this.resolve6 = options.resolve6 || dns.promises.resolve6;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_TESTRAIL_TIMEOUT_MS, 15000, 1000, 60000),
      maxRuns: clamp(process.env.SNEUP_TESTRAIL_MAX_RUNS, 100, 1, 250),
      maxResponseBytes: clamp(process.env.SNEUP_TESTRAIL_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000)
    };
  }

  getCredentials(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const username = String(credentials.username || '').trim();
    const apiKey = credentials.apiKey || credentials.token;
    if (!username || !apiKey) {
      const error = new Error('TestRail username and API key are required. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return { username, apiKey };
  }

  getTarget(account) {
    let baseUrl;
    try { baseUrl = new URL(String(account?.metadata?.fields?.baseUrl || '').trim()); } catch { baseUrl = null; }
    if (!baseUrl || baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.port || baseUrl.search || baseUrl.hash || !['', '/'].includes(baseUrl.pathname)) {
      const error = new Error('TestRail requires a public HTTPS base URL without a path, port, credentials, query, or fragment.');
      error.statusCode = 400;
      throw error;
    }
    return baseUrl;
  }

  getProjectId(account) {
    const projectId = numericId(account?.metadata?.fields?.projectId);
    if (!projectId) {
      const error = new Error('A numeric TestRail project ID is required to keep run sync scoped to one project.');
      error.statusCode = 400;
      throw error;
    }
    return projectId;
  }

  async resolvePublicAddresses(hostname) {
    if (net.isIP(hostname)) return privateAddress(hostname) ? [] : [{ address: hostname, family: net.isIP(hostname) }];
    if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) return [];
    const results = await Promise.allSettled([this.resolve4(hostname), this.resolve6(hostname)]);
    const addresses = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
      .map(address => ({ address, family: net.isIP(address) }))
      .filter(item => item.family);
    return addresses.length && addresses.every(item => !privateAddress(item.address)) ? addresses : [];
  }

  createRequestOptions(target, addresses, credentials, config) {
    const lookup = (hostname, options, callback) => {
      const family = typeof options === 'number' ? options : options?.family || 0;
      const address = addresses.find(item => !family || item.family === family);
      if (!address || hostname !== target.hostname) return callback(Object.assign(new Error('TestRail lookup rejected an unexpected host.'), { code: 'ENOTFOUND' }));
      return callback(null, address.address, address.family);
    };
    return {
      auth: { username: credentials.username, password: credentials.apiKey },
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false,
      httpsAgent: new https.Agent({ keepAlive: false, lookup })
    };
  }

  getRuns(payload) {
    if (!Array.isArray(payload?.runs)) {
      const error = new Error('TestRail run response must contain a runs array.');
      error.statusCode = 502;
      throw error;
    }
    return payload.runs;
  }

  assertBounded(payload, runs, maximum) {
    if (runs.length > maximum || payload?._links?.next) {
      const error = new Error('TestRail sync reached its configured run limit. Narrow the project scope or increase SNEUP_TESTRAIL_MAX_RUNS before continuing.');
      error.statusCode = 413;
      throw error;
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const credentials = this.getCredentials(account);
    const target = this.getTarget(account);
    const projectId = this.getProjectId(account);
    const addresses = await this.resolvePublicAddresses(target.hostname);
    if (addresses.length === 0) {
      const error = new Error('TestRail base URL must resolve only to public network addresses.');
      error.statusCode = 400;
      throw error;
    }
    const response = await this.http.get(`${target.origin}/index.php?/api/v2/get_runs/${projectId}`, {
      ...this.createRequestOptions(target, addresses, credentials, config),
      params: { is_completed: 0, include_plan_runs: 1, limit: config.maxRuns, offset: 0 }
    });
    const runs = this.getRuns(response.data);
    this.assertBounded(response.data, runs, config.maxRuns);
    const records = runs.map(runRecord).filter(Boolean);
    const newest = records.reduce((latest, item) => {
      const updated = dateFromSeconds(item.updatedAt || item.createdAt);
      return updated && (!latest || updated > latest) ? updated : latest;
    }, cursor ? new Date(cursor) : null);

    return {
      records,
      nextCursor: newest && !Number.isNaN(newest.getTime()) ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'testrail_api',
        projectId,
        activeRuns: records.length,
        contentPolicy: 'bounded_active_test_run_metadata_only_no_cases_results_descriptions_references_custom_fields_attachments_or_provider_writes'
      }
    };
  }
}

const testRailWorkSignalClient = new TestRailWorkSignalClient();
module.exports = testRailWorkSignalClient;
module.exports.TestRailWorkSignalClient = TestRailWorkSignalClient;
