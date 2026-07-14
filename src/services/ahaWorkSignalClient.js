const axios = require('axios');
const net = require('net');
const accountConnectorService = require('./accountConnectorService');

const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const parseDate = value => { const parsed = new Date(value); return value && !Number.isNaN(parsed.getTime()) ? parsed : null; };
const privateIpv4 = host => { const parts = host.split('.').map(Number); return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) && (parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)); };
const safeUrl = (value, accountUrl) => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && url.origin === accountUrl ? url.toString() : undefined; } catch { return undefined; } };
const product = (item, accountUrl) => validId(item?.id) && item.name ? compact({ id: `product:${item.id}`, sourceType: 'product', productId: item.id, reference: item.reference_prefix, name: item.name, workspaceType: item.workspace_type, createdAt: item.created_at, updatedAt: item.updated_at || item.created_at, url: safeUrl(item.url, accountUrl) }) : null;
const feature = (item, products, accountUrl) => validId(item?.id) && item.name ? compact({ id: `feature:${item.id}`, sourceType: 'feature', featureId: item.id, reference: item.reference_num, productId: item.product_id, name: item.name, product: products.get(String(item.product_id)), status: item.workflow_status?.name || item.workflow_status, dueAt: item.due_date, createdAt: item.created_at, updatedAt: item.updated_at || item.created_at, url: safeUrl(item.url, accountUrl) }) : null;

class AhaWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig(account) { return { apiUrl: this.getApiUrl(account), timeout: clamp(process.env.SNEUP_AHA_TIMEOUT_MS, 15000, 1000, 60000), maxProducts: clamp(process.env.SNEUP_AHA_MAX_PRODUCTS, 100, 1, 500), maxFeatures: clamp(process.env.SNEUP_AHA_MAX_FEATURES, 2500, 1, 10000), pageSize: clamp(process.env.SNEUP_AHA_PAGE_SIZE, 200, 1, 200), lookback: clamp(process.env.SNEUP_AHA_CURSOR_LOOKBACK_MS, 60000, 0, 3600000) }; }

  getApiUrl(account) {
    const raw = String(account?.metadata?.fields?.accountUrl || account?.metadata?.fields?.baseUrl || '').trim(); let url;
    try { url = new URL(raw); } catch { url = null; }
    const host = url?.hostname?.toLowerCase() || '';
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !['/', '/api/v1', '/api/v1/'].includes(url.pathname) || !(host === 'aha.io' || /^[a-z0-9][a-z0-9-]*\.aha\.io$/.test(host)) || net.isIP(host) === 6 || privateIpv4(host)) { const error = new Error('Aha! account URL must be a public HTTPS *.aha.io URL without credentials or a custom port.'); error.statusCode = 400; throw error; }
    return `${url.origin}/api/v1`;
  }

  getToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.apiToken || credentials.token || credentials.apiKey || credentials.accessToken; if (!token) { const error = new Error('Aha! API token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }

  request(config, token, path, params) { return this.http.get(`${config.apiUrl}${path}`, { params, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'Sneup Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }

  async listPaged(config, token, { path, key, limit, label, fields, sanitize }) {
    const records = []; let page = 1; let totalPages = null;
    while (true) {
      const response = await this.request(config, token, path, { page, per_page: Math.min(config.pageSize, limit), fields }); const data = response.data; const raw = data?.[key]; const pagination = Array.isArray(data?.pagination) ? data.pagination[0] : data?.pagination;
      const totalRecords = Number(pagination?.total_records); const reportedPage = Number(pagination?.current_page); const reportedPages = Number(pagination?.total_pages);
      if (!Array.isArray(raw) || !Number.isInteger(reportedPage) || reportedPage !== page || !Number.isInteger(reportedPages) || reportedPages < page || (Number.isFinite(totalRecords) && totalRecords < raw.length)) { const error = new Error(`Aha! returned an invalid ${label} page. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
      if (Number.isFinite(totalRecords) && totalRecords > limit) { const error = new Error(`Aha! sync reached its configured ${label} limit. Increase the corresponding SNEUP_AHA limit before continuing.`); error.statusCode = 413; throw error; }
      if (raw.length > limit - records.length) { const error = new Error(`Aha! returned more ${label} than Sneup is configured to process. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
      records.push(...raw.map(sanitize).filter(Boolean)); totalPages = reportedPages;
      if (page >= totalPages) return records;
      if (records.length >= limit) { const error = new Error(`Aha! sync reached its configured ${label} limit. Increase the corresponding SNEUP_AHA limit before continuing.`); error.statusCode = 413; throw error; }
      page += 1;
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(account); const token = this.getToken(account); const cursorDate = parseDate(cursor); const accountUrl = config.apiUrl.replace('/api/v1', '');
    const products = await this.listPaged(config, token, { path: '/products', key: 'products', limit: config.maxProducts, label: 'product', fields: 'id,reference_prefix,name,workspace_type,created_at,updated_at,url', sanitize: item => product(item, accountUrl) });
    const productMap = new Map(products.map(item => [String(item.productId), { id: item.productId, name: item.name, reference: item.reference }]));
    const features = await this.listPaged(config, token, { path: '/features', key: 'features', limit: config.maxFeatures, label: 'feature', fields: 'id,reference_num,name,product_id,workflow_status,due_date,created_at,updated_at,url', sanitize: item => feature(item, productMap, accountUrl) });
    const records = [...products, ...features].filter(item => { const updated = parseDate(item.updatedAt || item.createdAt); return !cursorDate || !updated || updated >= new Date(cursorDate.getTime() - config.lookback); });
    const newest = records.reduce((latest, item) => { const updated = parseDate(item.updatedAt || item.createdAt); return updated && (!latest || updated > latest) ? updated : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'aha_api', products: products.length, features: features.length, contentPolicy: 'product_feature_metadata_only_server_field_allowlist_no_descriptions_notes_comments_attachments_custom_fields_or_provider_writes' } };
  }
}

const ahaWorkSignalClient = new AhaWorkSignalClient();
module.exports = ahaWorkSignalClient;
module.exports.AhaWorkSignalClient = AhaWorkSignalClient;
