const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const validId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
const parseDate = value => { const parsed = new Date(value); return value && !Number.isNaN(parsed.getTime()) ? parsed : null; };
const statusName = value => typeof value === 'object' ? value?.name || value?.label || value?.value : value;
const entity = item => validId(item?.id) && ['component', 'feature', 'objective'].includes(item.type) && item.fields?.name ? compact({ id: `${item.type}:${item.id}`, sourceType: item.type, entityId: item.id, name: item.fields.name, status: statusName(item.fields.status), dueAt: item.fields.timeframe?.endDate, createdAt: item.createdAt, updatedAt: item.updatedAt || item.createdAt }) : null;

class ProductboardWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig() { return { apiUrl: 'https://api.productboard.com/v2', timeout: clamp(process.env.SNEUP_PRODUCTBOARD_TIMEOUT_MS, 15000, 1000, 60000), maxComponents: clamp(process.env.SNEUP_PRODUCTBOARD_MAX_COMPONENTS, 500, 1, 5000), maxFeatures: clamp(process.env.SNEUP_PRODUCTBOARD_MAX_FEATURES, 2500, 1, 10000), maxObjectives: clamp(process.env.SNEUP_PRODUCTBOARD_MAX_OBJECTIVES, 500, 1, 5000), lookback: clamp(process.env.SNEUP_PRODUCTBOARD_CURSOR_LOOKBACK_MS, 60000, 0, 3600000) }; }

  getToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.apiToken || credentials.token || credentials.apiKey || credentials.accessToken; if (!token) { const error = new Error('Productboard API token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }

  request(config, token, params) { return this.http.get(`${config.apiUrl}/entities`, { params, headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }

  nextCursor(value) {
    if (!value) return null;
    let url;
    try { url = new URL(value); } catch { url = null; }
    if (!url || url.protocol !== 'https:' || url.hostname !== 'api.productboard.com' || url.pathname !== '/v2/entities' || url.username || url.password || url.port || !url.searchParams.get('pageCursor')) { const error = new Error('Productboard returned an unsafe pagination cursor. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
    return url.searchParams.get('pageCursor');
  }

  async listType(config, token, type, limit) {
    const records = []; const seen = new Set(); let cursor = null;
    while (true) {
      const response = await this.request(config, token, { 'type[]': type, 'fields[]': ['name', 'status', 'timeframe'], ...(cursor ? { pageCursor: cursor } : {}) }); const data = response.data; const raw = data?.data;
      if (!Array.isArray(raw)) { const error = new Error(`Productboard returned an invalid ${type} page. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
      if (raw.length > limit - records.length) { const error = new Error(`Productboard sync reached its configured ${type} limit. Increase the corresponding SNEUP_PRODUCTBOARD limit before continuing.`); error.statusCode = 413; throw error; }
      for (const item of raw) { const record = entity(item); if (record && record.sourceType === type && !seen.has(record.id)) { seen.add(record.id); records.push(record); } }
      const next = this.nextCursor(data?.links?.next);
      if (!next) return records;
      if (records.length >= limit) { const error = new Error(`Productboard sync reached its configured ${type} limit. Increase the corresponding SNEUP_PRODUCTBOARD limit before continuing.`); error.statusCode = 413; throw error; }
      cursor = next;
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const token = this.getToken(account); const cursorDate = parseDate(cursor);
    const components = await this.listType(config, token, 'component', config.maxComponents);
    const features = await this.listType(config, token, 'feature', config.maxFeatures);
    const objectives = await this.listType(config, token, 'objective', config.maxObjectives);
    const records = [...components, ...features, ...objectives].filter(item => { const updated = parseDate(item.updatedAt || item.createdAt); return !cursorDate || !updated || updated >= new Date(cursorDate.getTime() - config.lookback); });
    const newest = records.reduce((latest, item) => { const updated = parseDate(item.updatedAt || item.createdAt); return updated && (!latest || updated > latest) ? updated : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'productboard_api', components: components.length, features: features.length, objectives: objectives.length, contentPolicy: 'component_feature_objective_metadata_only_server_field_allowlist_no_descriptions_owners_tags_notes_custom_fields_relationships_or_provider_writes' } };
  }
}

const productboardWorkSignalClient = new ProductboardWorkSignalClient();
module.exports = productboardWorkSignalClient;
module.exports.ProductboardWorkSignalClient = ProductboardWorkSignalClient;
