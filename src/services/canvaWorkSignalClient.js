const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

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
const dateFromUnixSeconds = value => {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 4102444800) return undefined;
  return new Date(value * 1000).toISOString();
};
const safeId = value => /^[A-Za-z0-9_-]{1,256}$/.test(String(value || '')) ? String(value) : undefined;
const invalidResponse = message => {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
};

class CanvaWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_CANVA_TIMEOUT_MS, 15000, 1000, 60000),
      maxDesigns: clamp(process.env.SNEUP_CANVA_MAX_DESIGNS, 100, 1, 100),
      maxResponseBytes: clamp(process.env.SNEUP_CANVA_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000),
      cursorLookbackMs: clamp(process.env.SNEUP_CANVA_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('Canva access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  normalizeDesign(item) {
    const designId = safeId(item?.id);
    const createdAt = dateFromUnixSeconds(item?.created_at);
    const updatedAt = dateFromUnixSeconds(item?.updated_at);
    if (!designId || (item?.created_at !== undefined && !createdAt) || (item?.updated_at !== undefined && !updatedAt)) return null;
    return {
      id: `canva:${designId}`,
      sourceType: 'design',
      designId,
      name: clean(item?.title) || `Canva design ${designId}`,
      status: 'open',
      createdAt,
      updatedAt
    };
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const cursorDate = cursor ? new Date(cursor) : null;
    if (cursor && Number.isNaN(cursorDate.getTime())) {
      const error = new Error('Canva work-signal cursor is invalid. Reconnect this account to establish a new cursor.');
      error.statusCode = 400;
      throw error;
    }
    const response = await this.http.get('https://api.canva.com/rest/v1/designs', {
      params: { limit: config.maxDesigns, ownership: 'any', sort_by: 'modified_descending' },
      headers: { Accept: 'application/json', Authorization: `Bearer ${this.getAccessToken(account)}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
    if (!Array.isArray(response.data?.items)) throw invalidResponse('Canva returned an invalid design collection. Reconnect this account before syncing again.');
    if (response.data.items.length > config.maxDesigns || response.data.continuation) {
      const error = new Error('Canva sync reached an incomplete design page. Increase SNEUP_CANVA_MAX_DESIGNS before continuing.');
      error.statusCode = 413;
      throw error;
    }
    const threshold = cursorDate ? cursorDate.getTime() - config.cursorLookbackMs : null;
    const records = response.data.items
      .map(item => this.normalizeDesign(item))
      .filter(Boolean)
      .filter(item => !threshold || !item.updatedAt || new Date(item.updatedAt).getTime() >= threshold);
    const newest = records.reduce((latest, item) => {
      const updated = new Date(item.updatedAt || item.createdAt || 0);
      return !Number.isNaN(updated.getTime()) && (!latest || updated > latest) ? updated : latest;
    }, cursorDate);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'canva_design_metadata',
        designs: records.length,
        contentPolicy: 'bounded_canva_design_metadata_only_no_design_content_pages_thumbnails_temporary_links_owners_folders_assets_comments_approvals_or_provider_writes'
      }
    };
  }
}

const canvaWorkSignalClient = new CanvaWorkSignalClient();
module.exports = canvaWorkSignalClient;
module.exports.CanvaWorkSignalClient = CanvaWorkSignalClient;
