const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://coda.io/apis/v1';
const ALLOWED_HOSTS = new Set(['coda.io', 'www.coda.io']);

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const compactObject = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));

const safeBrowserLink = (value) => {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const sanitizeTable = (documentId, table = {}) => compactObject({
  id: table.id ? `table:${documentId}:${table.id}` : undefined,
  sourceType: 'document',
  documentId,
  tableId: table.id,
  name: table.name,
  tableType: table.tableType,
  rowCount: Number.isFinite(Number(table.rowCount)) ? Number(table.rowCount) : undefined,
  browserLink: safeBrowserLink(table.browserLink),
  createdAt: table.createdAt,
  updatedAt: table.updatedAt
});

class CodaWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
    this.now = options.now || (() => new Date());
  }

  getConfig() {
    return {
      timeout: clampInteger(process.env.SNEUP_CODA_TIMEOUT_MS, 15000, 1000, 60000),
      maxDocuments: clampInteger(process.env.SNEUP_CODA_MAX_DOCUMENTS, 25, 1, 100),
      maxTablesPerDocument: clampInteger(process.env.SNEUP_CODA_MAX_TABLES_PER_DOCUMENT, 100, 1, 500),
      pageSize: clampInteger(process.env.SNEUP_CODA_PAGE_SIZE, 100, 1, 100)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.accessToken || credentials.apiKey;
    if (!token) {
      const error = new Error('Coda personal access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  getDocumentIds(account, config) {
    const raw = String(account?.metadata?.fields?.documentIds || '');
    const ids = [...new Set(raw.split(',').map(value => value.trim()).filter(Boolean))];
    if (ids.length === 0) {
      const error = new Error('At least one Coda document ID is required. Reconnect this account with only the documents Sneup may read.');
      error.statusCode = 400;
      throw error;
    }
    if (ids.some(id => !/^[A-Za-z0-9_-]{3,200}$/.test(id))) {
      const error = new Error('Coda document IDs must contain only letters, numbers, underscores, or hyphens.');
      error.statusCode = 400;
      throw error;
    }
    if (ids.length > config.maxDocuments) {
      const error = new Error('Coda sync exceeds its configured document limit. Reduce the allowed document IDs or increase SNEUP_CODA_MAX_DOCUMENTS.');
      error.statusCode = 413;
      throw error;
    }
    return ids;
  }

  request(path, token, config, params = {}) {
    return this.http.get(`${API_URL}${path}`, {
      params,
      timeout: config.timeout,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
    });
  }

  async listTables(documentId, token, config) {
    const records = [];
    let pageToken;
    do {
      const remaining = config.maxTablesPerDocument - records.length;
      if (remaining <= 0) {
        const error = new Error(`Coda sync reached its configured table limit for document ${documentId}. Increase SNEUP_CODA_MAX_TABLES_PER_DOCUMENT before continuing.`);
        error.statusCode = 413;
        throw error;
      }
      const response = await this.request(`/docs/${encodeURIComponent(documentId)}/tables`, token, config, {
        limit: Math.min(config.pageSize, remaining),
        ...(pageToken ? { pageToken } : {})
      });
      const page = Array.isArray(response.data?.items) ? response.data.items : [];
      if (page.length > remaining) {
        const error = new Error('Coda returned more table metadata than Sneup is configured to process. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
      records.push(...page.map(table => sanitizeTable(documentId, table)).filter(table => table.id && table.name));
      pageToken = response.data?.nextPageToken;
      if (pageToken && page.length === 0) {
        const error = new Error('Coda returned an incomplete table page. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
      if (pageToken && records.length >= config.maxTablesPerDocument) {
        const error = new Error(`Coda sync reached its configured table limit for document ${documentId}. Increase SNEUP_CODA_MAX_TABLES_PER_DOCUMENT before continuing.`);
        error.statusCode = 413;
        throw error;
      }
    } while (pageToken);
    return records;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const documentIds = this.getDocumentIds(account, config);
    const records = [];
    let newest = parseDate(cursor);

    for (const documentId of documentIds) {
      const tables = await this.listTables(documentId, token, config);
      for (const table of tables) {
        const updatedAt = parseDate(table.updatedAt || table.createdAt);
        if (updatedAt && (!newest || updatedAt > newest)) newest = updatedAt;
        records.push(table);
      }
    }

    return {
      records,
      nextCursor: newest ? newest.toISOString() : records.length > 0 ? this.now().toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'coda_api',
        documents: documentIds.length,
        tables: records.length,
        contentPolicy: 'allowlisted_document_table_metadata_only'
      }
    };
  }
}

const codaWorkSignalClient = new CodaWorkSignalClient();

module.exports = codaWorkSignalClient;
module.exports.CodaWorkSignalClient = CodaWorkSignalClient;
