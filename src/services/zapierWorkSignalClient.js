const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.zapier.com/v2/zaps';
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
const safeId = value => /^[A-Za-z0-9_-]{1,256}$/.test(String(value || '')) ? String(value) : undefined;
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

const automationRecord = zap => {
  const zapId = safeId(zap?.id);
  const name = boundedText(zap?.title);
  const updatedAt = parseDate(zap?.updated_at);
  const lastSuccessfulRunAt = parseDate(zap?.last_successful_run_date);
  if (!zapId || !name || typeof zap?.is_enabled !== 'boolean' || (zap?.updated_at && !updatedAt) || (zap?.last_successful_run_date && !lastSuccessfulRunAt)) return null;
  return compact({
    id: `zapier_automation:${zapId}`,
    sourceType: 'automation',
    zapId,
    name,
    status: zap.is_enabled ? 'active' : 'inactive',
    lastSuccessfulRunAt,
    updatedAt
  });
};

class ZapierWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_ZAPIER_TIMEOUT_MS, 15000, 1000, 60000),
      maxZaps: clamp(process.env.SNEUP_ZAPIER_MAX_ZAPS, 100, 1, 500),
      maxResponseBytes: clamp(process.env.SNEUP_ZAPIER_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000),
      cursorLookbackMs: clamp(process.env.SNEUP_ZAPIER_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('Zapier access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  getPayload(response) {
    const payload = Array.isArray(response?.data) && response.data.length === 1 ? response.data[0] : response?.data;
    if (!Array.isArray(payload?.data) || !payload.links || typeof payload.links !== 'object') {
      throw invalidResponse('Zapier returned an invalid automation collection. Reconnect this account before syncing again.');
    }
    return payload;
  }

  isWithinCursor(automation, cursor, config) {
    if (!cursor) return true;
    const updated = new Date(automation.updatedAt || automation.lastSuccessfulRunAt || 0).getTime();
    return !Number.isFinite(updated) || updated >= cursor.getTime() - config.cursorLookbackMs;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const cursorDate = cursor && !Number.isNaN(new Date(cursor).getTime()) ? new Date(cursor) : null;
    if (cursor && !cursorDate) {
      const error = new Error('Zapier work-signal cursor is invalid. Reconnect this account to establish a new cursor.');
      error.statusCode = 400;
      throw error;
    }
    const response = await this.http.get(API_URL, {
      params: { limit: config.maxZaps, offset: 0, include_shared: false },
      headers: { Accept: 'application/json', Authorization: `Bearer ${this.getAccessToken(account)}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
    const payload = this.getPayload(response);
    if (payload.data.length > config.maxZaps || payload.links.next) {
      const error = new Error('Zapier sync reached an incomplete automation page. Increase SNEUP_ZAPIER_MAX_ZAPS before continuing.');
      error.statusCode = 413;
      throw error;
    }
    const records = payload.data
      .map(automationRecord)
      .filter(Boolean)
      .filter(automation => this.isWithinCursor(automation, cursorDate, config));
    const newest = records.reduce((latest, automation) => {
      const updated = new Date(automation.updatedAt || automation.lastSuccessfulRunAt || 0);
      return !Number.isNaN(updated.getTime()) && (!latest || updated > latest) ? updated : latest;
    }, cursorDate);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'zapier_automation_metadata',
        workflows: records.length,
        contentPolicy: 'bounded_zapier_automation_metadata_only_no_steps_inputs_linked_authentications_editor_urls_run_payloads_user_profiles_webhooks_or_provider_writes'
      }
    };
  }
}

const zapierWorkSignalClient = new ZapierWorkSignalClient();
module.exports = zapierWorkSignalClient;
module.exports.ZapierWorkSignalClient = ZapierWorkSignalClient;
