const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://datastudio.googleapis.com/v1/assets:search';
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

const assetRecord = asset => {
  const assetId = safeId(asset?.name);
  const sourceType = asset?.assetType === 'REPORT' ? 'report' : asset?.assetType === 'DATA_SOURCE' ? 'data_source' : undefined;
  const name = boundedText(asset?.title);
  const createdAt = parseDate(asset?.createTime);
  const updatedAt = parseDate(asset?.updateTime);
  if (!assetId || !sourceType || !name || asset?.trashed || (asset?.createTime && !createdAt) || (asset?.updateTime && !updatedAt)) return null;
  return compact({ id: `data_studio_${sourceType}:${assetId}`, sourceType, assetId, name, status: 'open', createdAt, updatedAt });
};

class DataStudioWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_DATA_STUDIO_TIMEOUT_MS, 15000, 1000, 60000),
      maxReports: clamp(process.env.SNEUP_DATA_STUDIO_MAX_REPORTS, 100, 1, 500),
      maxDataSources: clamp(process.env.SNEUP_DATA_STUDIO_MAX_DATA_SOURCES, 100, 1, 500),
      maxResponseBytes: clamp(process.env.SNEUP_DATA_STUDIO_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000),
      cursorLookbackMs: clamp(process.env.SNEUP_DATA_STUDIO_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('Data Studio access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  async fetchAssetType(account, assetType, limit, config) {
    const response = await this.http.get(API_URL, {
      params: { assetTypes: assetType, pageSize: limit, includeTrashed: false, orderBy: 'id' },
      headers: { Accept: 'application/json', Authorization: `Bearer ${this.getAccessToken(account)}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
    if (!Array.isArray(response?.data?.assets)) throw invalidResponse('Data Studio returned an invalid asset collection. Reconnect this account before syncing again.');
    if (response.data.assets.length > limit || response.data.nextPageToken) {
      const error = new Error(`Data Studio sync reached an incomplete ${assetType.toLowerCase()} metadata page. Increase the configured limit before continuing.`);
      error.statusCode = 413;
      throw error;
    }
    return response.data.assets.map(assetRecord).filter(Boolean);
  }

  isWithinCursor(asset, cursor, config) {
    if (!cursor) return true;
    const updated = new Date(asset.updatedAt || asset.createdAt || 0).getTime();
    return !Number.isFinite(updated) || updated >= cursor.getTime() - config.cursorLookbackMs;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const cursorDate = cursor && !Number.isNaN(new Date(cursor).getTime()) ? new Date(cursor) : null;
    if (cursor && !cursorDate) {
      const error = new Error('Data Studio work-signal cursor is invalid. Reconnect this account to establish a new cursor.');
      error.statusCode = 400;
      throw error;
    }
    const [reports, dataSources] = await Promise.all([
      this.fetchAssetType(account, 'REPORT', config.maxReports, config),
      this.fetchAssetType(account, 'DATA_SOURCE', config.maxDataSources, config)
    ]);
    const records = [...reports, ...dataSources].filter(asset => this.isWithinCursor(asset, cursorDate, config));
    const newest = records.reduce((latest, asset) => {
      const updated = new Date(asset.updatedAt || asset.createdAt || 0);
      return !Number.isNaN(updated.getTime()) && (!latest || updated > latest) ? updated : latest;
    }, cursorDate);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'data_studio_asset_metadata',
        reports: reports.filter(asset => this.isWithinCursor(asset, cursorDate, config)).length,
        dataSources: dataSources.filter(asset => this.isWithinCursor(asset, cursorDate, config)).length,
        contentPolicy: 'bounded_data_studio_report_data_source_metadata_only_no_descriptions_owners_creators_urls_filters_sections_dimensions_permissions_configuration_or_provider_writes'
      }
    };
  }
}

const dataStudioWorkSignalClient = new DataStudioWorkSignalClient();
module.exports = dataStudioWorkSignalClient;
module.exports.DataStudioWorkSignalClient = DataStudioWorkSignalClient;
