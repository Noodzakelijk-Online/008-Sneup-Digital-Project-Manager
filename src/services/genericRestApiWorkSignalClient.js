const axios = require('axios');
const dns = require('dns');
const https = require('https');
const net = require('net');
const accountConnectorService = require('./accountConnectorService');

const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const parseDate = value => { const parsed = new Date(value); return value && !Number.isNaN(parsed.getTime()) ? parsed : null; };
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const safeKey = value => /^[A-Za-z0-9_-]{1,80}$/.test(String(value || ''));
const safeRecordId = value => /^[A-Za-z0-9:_-]{1,160}$/.test(String(value || ''));

const privateAddress = (value) => {
  const family = net.isIP(value); const address = String(value || '').toLowerCase();
  if (family === 4) { const octets = address.split('.').map(Number); return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && (octets[1] === 0 || octets[1] === 168 || octets[1] === 2)) || (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19 || octets[1] === 51)) || (octets[0] === 203 && octets[1] === 0 && octets[2] === 113) || octets[0] >= 224; }
  if (family === 6) { if (address === '::' || address === '::1' || address.startsWith('fc') || address.startsWith('fd') || /^fe[89ab]/.test(address)) return true; const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); return Boolean(mapped && privateAddress(mapped[1])); }
  return true;
};

const itemRecord = item => {
  const id = String(item?.id ?? item?.key ?? item?.uuid ?? ''); const name = boundedText(item?.name ?? item?.title ?? item?.summary ?? item?.key, 160);
  if (!safeRecordId(id) || !name) return null;
  return compact({ id: `record:${id}`, sourceType: 'record', recordId: id, name, status: boundedText(item?.status ?? item?.state, 64), priority: boundedText(item?.priority ?? item?.severity, 64), createdAt: item?.created_at ?? item?.createdAt, updatedAt: item?.updated_at ?? item?.updatedAt ?? item?.modified_at ?? item?.modifiedAt });
};

class GenericRestApiWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.resolve4 = options.resolve4 || dns.promises.resolve4; this.resolve6 = options.resolve6 || dns.promises.resolve6; }

  getConfig() { return { timeout: clamp(process.env.SNEUP_GENERIC_REST_TIMEOUT_MS, 15000, 1000, 60000), maxRecords: clamp(process.env.SNEUP_GENERIC_REST_MAX_RECORDS, 500, 1, 5000), maxResponseBytes: clamp(process.env.SNEUP_GENERIC_REST_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000) }; }

  getToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.apiKey || credentials.token || credentials.accessToken; if (!token) { const error = new Error('Generic REST API bearer token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }

  getTarget(account) {
    const fields = account?.metadata?.fields || {}; let baseUrl;
    try { baseUrl = new URL(String(fields.baseUrl || '').trim()); } catch { baseUrl = null; }
    const endpointPath = String(fields.endpointPath || '').trim(); const recordPath = String(fields.recordPath || '').trim();
    if (!baseUrl || baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.port || baseUrl.search || baseUrl.hash || !endpointPath || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,500}$/.test(endpointPath) || endpointPath.includes('//') || endpointPath.split('/').includes('..') || (recordPath && (!recordPath.split('.').every(safeKey) || recordPath.split('.').length > 6))) { const error = new Error('Generic REST API requires a public HTTPS base URL, a safe absolute endpoint path, and an optional dotted JSON record path.'); error.statusCode = 400; throw error; }
    const target = new URL(baseUrl.toString()); target.pathname = `${baseUrl.pathname.replace(/\/$/, '')}${endpointPath}`; target.search = ''; target.hash = '';
    return { baseUrl, target, recordPath: recordPath ? recordPath.split('.') : [] };
  }

  async resolvePublicAddresses(hostname) {
    if (net.isIP(hostname)) { if (privateAddress(hostname)) return []; return [{ address: hostname, family: net.isIP(hostname) }]; }
    if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) return [];
    const results = await Promise.allSettled([this.resolve4(hostname), this.resolve6(hostname)]); const addresses = results.flatMap(result => result.status === 'fulfilled' ? result.value : []).map(address => ({ address, family: net.isIP(address) })).filter(item => item.family);
    return addresses.length && addresses.every(item => !privateAddress(item.address)) ? addresses : [];
  }

  getCollection(data, recordPath) { const collection = recordPath.reduce((value, key) => value && typeof value === 'object' ? value[key] : undefined, data); if (!Array.isArray(collection)) { const error = new Error('Generic REST API endpoint must return a JSON array at the configured record path.'); error.statusCode = 502; throw error; } return collection; }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const token = this.getToken(account); const { target, recordPath } = this.getTarget(account); const addresses = await this.resolvePublicAddresses(target.hostname);
    if (addresses.length === 0) { const error = new Error('Generic REST API target must resolve only to public network addresses.'); error.statusCode = 400; throw error; }
    const lookup = (hostname, options, callback) => { const family = typeof options === 'number' ? options : options?.family || 0; const address = addresses.find(item => !family || item.family === family); if (!address || hostname !== target.hostname) return callback(Object.assign(new Error('Generic REST API lookup rejected an unexpected host.'), { code: 'ENOTFOUND' })); return callback(null, address.address, address.family); };
    const response = await this.http.get(target.toString(), { headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxContentLength: config.maxResponseBytes, maxBodyLength: config.maxResponseBytes, maxRedirects: 0, proxy: false, httpsAgent: new https.Agent({ keepAlive: false, lookup }) });
    const collection = this.getCollection(response.data, recordPath);
    if (collection.length > config.maxRecords) { const error = new Error('Generic REST API sync reached its configured record limit. Narrow the endpoint or increase SNEUP_GENERIC_REST_MAX_RECORDS before continuing.'); error.statusCode = 413; throw error; }
    const records = collection.map(itemRecord).filter(Boolean); const cursorDate = parseDate(cursor); const newest = records.reduce((latest, item) => { const updated = parseDate(item.updatedAt || item.createdAt); return updated && (!latest || updated > latest) ? updated : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'generic_rest_api', endpoint: target.pathname, recordPath: recordPath.join('.') || '$', records: records.length, contentPolicy: 'single_bounded_json_collection_metadata_only_no_raw_payload_pagination_or_provider_writes' } };
  }
}

const genericRestApiWorkSignalClient = new GenericRestApiWorkSignalClient();
module.exports = genericRestApiWorkSignalClient;
module.exports.GenericRestApiWorkSignalClient = GenericRestApiWorkSignalClient;
