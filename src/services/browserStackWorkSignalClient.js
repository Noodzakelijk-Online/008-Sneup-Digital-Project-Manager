const axios = require('axios');
const https = require('https');
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
const buildId = value => /^[A-Za-z0-9_-]{8,128}$/.test(String(value || '')) ? String(value) : undefined;
const durationMs = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 604800000 ? Math.round(parsed) : undefined;
};

const buildRecord = wrapper => {
  const item = wrapper?.automation_build;
  const hashedId = buildId(item?.hashed_id);
  const name = boundedText(item?.name);
  const sourceStatus = String(item?.status || '').toLowerCase();
  if (!hashedId || !name || !['running', 'done', 'timeout', 'failed'].includes(sourceStatus)) return null;
  const status = sourceStatus === 'running' ? 'in_progress' : sourceStatus === 'done' ? 'done' : 'blocked';

  return compact({
    id: `build:${hashedId}`,
    sourceType: 'execution',
    buildId: hashedId,
    name,
    status,
    priority: sourceStatus === 'failed' ? 'high' : sourceStatus === 'timeout' ? 'normal' : 'unknown',
    durationMs: durationMs(item.duration),
    completed: sourceStatus !== 'running'
  });
};

class BrowserStackWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_BROWSERSTACK_TIMEOUT_MS, 15000, 1000, 60000),
      maxBuilds: clamp(process.env.SNEUP_BROWSERSTACK_MAX_BUILDS, 50, 1, 100),
      maxResponseBytes: clamp(process.env.SNEUP_BROWSERSTACK_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000)
    };
  }

  getCredentials(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const username = String(credentials.username || '').trim();
    const accessKey = credentials.accessKey || credentials.apiKey || credentials.token;
    if (!username || !accessKey) {
      const error = new Error('BrowserStack username and access key are required. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return { username, accessKey };
  }

  createRequestOptions(credentials, config) {
    return {
      auth: { username: credentials.username, password: credentials.accessKey },
      headers: { Accept: 'application/json', 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false,
      httpsAgent: new https.Agent({ keepAlive: false })
    };
  }

  getBuilds(payload) {
    if (!Array.isArray(payload)) {
      const error = new Error('BrowserStack build response must contain an array.');
      error.statusCode = 502;
      throw error;
    }
    return payload;
  }

  assertBounded(builds, maximum) {
    if (builds.length >= maximum) {
      const error = new Error('BrowserStack sync reached its configured build limit. Narrow the BrowserStack account scope or increase SNEUP_BROWSERSTACK_MAX_BUILDS before continuing.');
      error.statusCode = 413;
      throw error;
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const credentials = this.getCredentials(account);
    const response = await this.http.get('https://api.browserstack.com/automate/builds.json', {
      ...this.createRequestOptions(credentials, config),
      params: { limit: config.maxBuilds, offset: 0 }
    });
    const builds = this.getBuilds(response.data);
    this.assertBounded(builds, config.maxBuilds);
    const records = builds.map(buildRecord).filter(Boolean);

    return {
      records,
      nextCursor: cursor || null,
      hasMore: false,
      metadata: {
        source: 'browserstack_automate_api',
        recentBuilds: records.length,
        contentPolicy: 'bounded_build_health_metadata_only_no_public_urls_tags_sessions_logs_browser_device_data_or_provider_writes'
      }
    };
  }
}

const browserStackWorkSignalClient = new BrowserStackWorkSignalClient();
module.exports = browserStackWorkSignalClient;
module.exports.BrowserStackWorkSignalClient = BrowserStackWorkSignalClient;
