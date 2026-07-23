const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const LUCID_SEARCH_URL = 'https://api.lucid.co/v1/documents/search';
const LUCID_SEARCH_PATH = '/v1/documents/search';
const PRODUCTS = new Set(['lucidchart', 'lucidscale', 'lucidspark']);
const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const error = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const boundedText = value => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 160) : undefined;
};
const parseDate = value => {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const safePageToken = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001F\u007F]/.test(value);
const documents = body => Array.isArray(body) ? body : Array.isArray(body?.documents) ? body.documents : Array.isArray(body?.data) ? body.data : null;

const documentRecord = value => {
  const id = String(value?.id || '');
  const product = String(value?.product || '').toLowerCase();
  const createdAt = parseDate(value?.createdAt || value?.createdTimestamp);
  const updatedAt = parseDate(value?.lastModified || value?.lastModifiedAt || value?.modifiedAt || value?.modifiedTimestamp);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !PRODUCTS.has(product) || !boundedText(value?.title || value?.name) || ((value?.createdAt || value?.createdTimestamp) && !createdAt) || ((value?.lastModified || value?.lastModifiedAt || value?.modifiedAt || value?.modifiedTimestamp) && !updatedAt)) return null;
  return compact({ id: `document:${id}`, sourceType: 'document', documentId: id, product, name: boundedText(value.title || value.name), status: 'open', createdAt: createdAt?.toISOString(), updatedAt: updatedAt?.toISOString() });
};

const nextTokenFromLink = (link, pageSize) => {
  if (!link) return null;
  if (typeof link !== 'string' || link.length > 4096) return undefined;
  const match = link.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
  if (!match) return null;
  let next;
  try { next = new URL(match[1]); } catch { return undefined; }
  if (next.origin !== 'https://api.lucid.co' || next.pathname !== LUCID_SEARCH_PATH || next.username || next.password || next.port || next.hash || [...next.searchParams.keys()].some(key => !['pageToken', 'pageSize'].includes(key)) || next.searchParams.get('pageSize') !== String(pageSize)) return undefined;
  const token = next.searchParams.get('pageToken');
  return safePageToken(token) ? token : undefined;
};

class LucidWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_LUCID_TIMEOUT_MS, 15000, 1000, 60000),
      maxDocuments: clamp(process.env.SNEUP_LUCID_MAX_DOCUMENTS, 1000, 1, 5000),
      pageSize: clamp(process.env.SNEUP_LUCID_PAGE_SIZE, 100, 1, 200),
      maxPages: clamp(process.env.SNEUP_LUCID_MAX_PAGES, 100, 1, 250),
      maxResponseBytes: clamp(process.env.SNEUP_LUCID_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000),
      cursorLookbackMs: clamp(process.env.SNEUP_LUCID_CURSOR_LOOKBACK_MS, 60000, 0, 24 * 60 * 60 * 1000)
    };
  }

  getApiKey(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const apiKey = credentials.apiKey || credentials.token || credentials.accessToken;
    if (!apiKey) throw error('Lucid API key is missing. Reconnect this account to continue syncing.', 503);
    return apiKey;
  }

  request(apiKey, config, pageToken, lastModifiedAfter, pageSize) {
    return this.http.post(LUCID_SEARCH_URL, compact({ excludeTrashed: true, lastModifiedAfter: lastModifiedAfter?.toISOString() }), {
      params: compact({ pageSize, pageToken }),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'Lucid-Api-Version': '1' },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: 64 * 1024,
      maxRedirects: 0,
      proxy: false
    });
  }

  async fetchDelta(account, cursor) {
    const priorCursor = cursor ? parseDate(cursor) : null;
    if (cursor && !priorCursor) throw error('Lucid work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const config = this.getConfig();
    const apiKey = this.getApiKey(account);
    const cutoff = priorCursor ? new Date(priorCursor.getTime() - config.cursorLookbackMs) : null;
    const records = [];
    const seenTokens = new Set();
    let pageToken;
    let pages = 0;
    let scanned = 0;

    while (true) {
      if (pages >= config.maxPages) throw error('Lucid sync reached its configured page limit. Increase SNEUP_LUCID_MAX_PAGES before continuing.', 413);
      const remaining = config.maxDocuments - scanned;
      if (remaining <= 0) throw error('Lucid sync reached its configured document limit. Increase SNEUP_LUCID_MAX_DOCUMENTS before continuing.', 413);
      const pageSize = Math.min(config.pageSize, remaining);
      const response = await this.request(apiKey, config, pageToken, cutoff, pageSize);
      const values = documents(response?.data);
      const nextToken = nextTokenFromLink(response?.headers?.link, pageSize);
      if (!Array.isArray(values) || nextToken === undefined || values.length > pageSize) throw error('Lucid returned an invalid or over-limit document metadata page. Reconnect this account before syncing again.');
      const normalized = values.map(documentRecord);
      if (normalized.some(item => !item)) throw error('Lucid returned invalid document metadata. Reconnect this account before syncing again.');
      records.push(...normalized);
      scanned += values.length;
      pages += 1;
      if (!nextToken) {
        if (values.length === pageSize) throw error('Lucid omitted a required pagination link. Reconnect this account before syncing again.');
        break;
      }
      if (values.length === 0 || seenTokens.has(nextToken)) throw error('Lucid returned an incomplete or cyclic document metadata page. Reconnect this account before syncing again.');
      if (scanned >= config.maxDocuments) throw error('Lucid sync reached its configured document limit before the provider collection ended. Increase SNEUP_LUCID_MAX_DOCUMENTS before continuing.', 413);
      seenTokens.add(nextToken);
      pageToken = nextToken;
    }

    const newest = records.reduce((latest, record) => {
      const date = parseDate(record.updatedAt || record.createdAt);
      return date && (!latest || date > latest) ? date : latest;
    }, priorCursor);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'lucid_document_metadata', documents: records.length, pages, contentPolicy: 'bounded_document_metadata_only_no_document_content_pages_shapes_comments_owners_folders_sharing_exports_urls_or_provider_writes' } };
  }
}

const lucidWorkSignalClient = new LucidWorkSignalClient();
module.exports = lucidWorkSignalClient;
module.exports.LucidWorkSignalClient = LucidWorkSignalClient;
