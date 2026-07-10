const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const DEFAULT_API_URL = 'https://api.smartsheet.com/2.0';
const ALLOWED_API_HOSTS = new Set(['api.smartsheet.com', 'api.smartsheet.eu', 'api.smartsheet.au']);
const ALLOWED_APP_HOSTS = new Set(['app.smartsheet.com', 'app.smartsheet.eu', 'app.smartsheet.au']);
const SIGNAL_COLUMN_PATTERN = /\b(status|state|priority|assigned|assignee|owner|responsible|due|finish|end)\b/i;
const STATUS_COLUMN_PATTERN = /\b(status|state)\b/i;
const PRIORITY_COLUMN_PATTERN = /\bpriority\b/i;
const OWNER_COLUMN_PATTERN = /\b(assigned|assignee|owner|responsible)\b/i;
const DUE_COLUMN_PATTERN = /\b(due|finish|end)\b/i;

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

const cellText = (cell) => String(cell?.displayValue ?? cell?.value ?? '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 500);

const safePermalink = (value) => {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_APP_HOSTS.has(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const sanitizeSheet = (sheet) => ({
  id: sheet.id,
  name: sheet.name,
  owner: sheet.owner,
  ownerId: sheet.ownerId,
  modifiedAt: sheet.modifiedAt,
  permalink: safePermalink(sheet.permalink)
});

const selectColumns = (columns, maxColumns) => {
  const primary = columns.find(column => column?.primary) || columns.find(column => column?.id);
  const selected = [primary, ...columns.filter(column => SIGNAL_COLUMN_PATTERN.test(String(column?.title || '')))]
    .filter(column => column?.id)
    .filter((column, index, items) => items.findIndex(candidate => String(candidate.id) === String(column.id)) === index);
  if (selected.length > maxColumns) {
    const error = new Error('Smartsheet sync found too many signal columns. Increase SNEUP_SMARTSHEET_MAX_COLUMNS before continuing.');
    error.statusCode = 413;
    throw error;
  }
  return selected;
};

const rowValue = (row, columns, pattern) => {
  const column = columns.find(candidate => pattern.test(String(candidate.title || '')));
  if (!column) return '';
  return cellText((row.cells || []).find(cell => String(cell.columnId) === String(column.id)));
};

const sanitizeRow = (row, sheet, selectedColumns) => {
  const titleColumn = selectedColumns.find(column => column.primary) || selectedColumns[0];
  const title = titleColumn ? cellText((row.cells || []).find(cell => String(cell.columnId) === String(titleColumn.id))) : '';
  if (!title) return null;
  return {
    id: String(row.id),
    externalId: `sheet:${sheet.id}:row:${row.id}`,
    title,
    status: rowValue(row, selectedColumns, STATUS_COLUMN_PATTERN),
    priority: rowValue(row, selectedColumns, PRIORITY_COLUMN_PATTERN),
    owners: rowValue(row, selectedColumns, OWNER_COLUMN_PATTERN)
      .split(/[;,]/)
      .map(value => value.trim())
      .filter(Boolean),
    dueAt: rowValue(row, selectedColumns, DUE_COLUMN_PATTERN),
    createdAt: row.createdAt,
    modifiedAt: row.modifiedAt,
    parentId: row.parentId ? String(row.parentId) : undefined,
    sheet: { id: String(sheet.id), name: sheet.name, permalink: sheet.permalink },
    url: sheet.permalink
  };
};

class SmartsheetWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig(account) {
    return {
      apiUrl: this.getApiUrl(account),
      timeout: clampInteger(process.env.SNEUP_SMARTSHEET_TIMEOUT_MS, 15000, 1000, 60000),
      maxSheets: clampInteger(process.env.SNEUP_SMARTSHEET_MAX_SHEETS, 25, 1, 100),
      maxRowsPerSheet: clampInteger(process.env.SNEUP_SMARTSHEET_MAX_ROWS_PER_SHEET, 250, 1, 5000),
      maxTotalRows: clampInteger(process.env.SNEUP_SMARTSHEET_MAX_TOTAL_ROWS, 2500, 1, 10000),
      maxColumns: clampInteger(process.env.SNEUP_SMARTSHEET_MAX_COLUMNS, 12, 1, 50),
      pageSize: clampInteger(process.env.SNEUP_SMARTSHEET_PAGE_SIZE, 100, 1, 1000),
      cursorLookbackMs: clampInteger(process.env.SNEUP_SMARTSHEET_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.accessToken || credentials.apiKey;
    if (!token) {
      const error = new Error('Smartsheet API access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  getApiUrl(account) {
    const raw = String(account?.metadata?.fields?.apiUrl || process.env.SNEUP_SMARTSHEET_API_URL || DEFAULT_API_URL).trim();
    let url;
    try {
      url = new URL(raw);
    } catch {
      const error = new Error('Smartsheet API URL must use https://api.smartsheet.com/2.0, https://api.smartsheet.eu/2.0, or https://api.smartsheet.au/2.0.');
      error.statusCode = 400;
      throw error;
    }
    if (url.protocol !== 'https:' || !ALLOWED_API_HOSTS.has(url.hostname) || url.pathname.replace(/\/$/, '') !== '/2.0' || url.search || url.hash || url.username || url.password) {
      const error = new Error('Smartsheet API URL must use https://api.smartsheet.com/2.0, https://api.smartsheet.eu/2.0, or https://api.smartsheet.au/2.0.');
      error.statusCode = 400;
      throw error;
    }
    return url.toString().replace(/\/$/, '');
  }

  request(config, path, token, params = {}) {
    return this.http.get(`${config.apiUrl}${path}`, {
      params,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'smartsheet-integration-source': 'AI,Noodzakelijk,Sneup'
      },
      timeout: config.timeout
    });
  }

  async listSheets(token, config) {
    const sheets = [];
    let page = 1;
    let totalPages = 1;
    do {
      const remaining = config.maxSheets - sheets.length;
      if (remaining <= 0) {
        const error = new Error('Smartsheet sync reached its configured sheet limit. Increase SNEUP_SMARTSHEET_MAX_SHEETS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      const response = await this.request(config, '/sheets', token, { page, pageSize: Math.min(config.pageSize, remaining) });
      const listed = Array.isArray(response.data?.data) ? response.data.data : [];
      const totalCount = Number(response.data?.totalCount || 0);
      if (totalCount > config.maxSheets) {
        const error = new Error('Smartsheet sync reached its configured sheet limit. Increase SNEUP_SMARTSHEET_MAX_SHEETS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      sheets.push(...listed.map(sanitizeSheet));
      totalPages = Math.max(1, Number(response.data?.totalPages || 1));
      if (page < totalPages && listed.length === 0) {
        const error = new Error('Smartsheet returned an incomplete sheet page. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
      page += 1;
    } while (page <= totalPages);
    return sheets;
  }

  async listColumns(sheet, token, config) {
    const response = await this.request(config, `/sheets/${encodeURIComponent(sheet.id)}/columns`, token, { page: 1, pageSize: 100 });
    const columns = Array.isArray(response.data?.data) ? response.data.data : [];
    return selectColumns(columns, config.maxColumns);
  }

  async listSheetRows(sheet, token, config, cursorDate, state) {
    const selectedColumns = await this.listColumns(sheet, token, config);
    if (selectedColumns.length === 0) return;
    let page = 1;
    let totalPages = 1;
    let sheetRowCount = 0;
    const modifiedSince = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs).toISOString() : undefined;
    do {
      const remainingForSheet = config.maxRowsPerSheet - sheetRowCount;
      const remainingTotal = config.maxTotalRows - state.rowCount;
      if (remainingForSheet <= 0 || remainingTotal <= 0) {
        const error = new Error('Smartsheet sync reached its configured row limit. Increase SNEUP_SMARTSHEET_MAX_ROWS_PER_SHEET or SNEUP_SMARTSHEET_MAX_TOTAL_ROWS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      const response = await this.request(config, `/sheets/${encodeURIComponent(sheet.id)}`, token, {
        page,
        pageSize: Math.min(config.pageSize, remainingForSheet, remainingTotal),
        columnIds: selectedColumns.map(column => column.id).join(','),
        ...(modifiedSince ? { rowsModifiedSince: modifiedSince } : {})
      });
      const rows = Array.isArray(response.data?.rows) ? response.data.rows : [];
      const totalCount = Number(response.data?.totalCount || 0);
      if (totalCount > config.maxRowsPerSheet || totalCount > remainingTotal) {
        const error = new Error('Smartsheet sync reached its configured row limit. Increase SNEUP_SMARTSHEET_MAX_ROWS_PER_SHEET or SNEUP_SMARTSHEET_MAX_TOTAL_ROWS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      for (const row of rows) {
        const record = sanitizeRow(row, sheet, selectedColumns);
        if (!record) continue;
        const modifiedAt = parseDate(record.modifiedAt || record.createdAt);
        if (modifiedAt && (!state.newest || modifiedAt > state.newest)) state.newest = modifiedAt;
        state.records.push(record);
      }
      sheetRowCount += rows.length;
      state.rowCount += rows.length;
      totalPages = Math.max(1, Number(response.data?.totalPages || 1));
      if (page < totalPages && rows.length === 0) {
        const error = new Error('Smartsheet returned an incomplete row page. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
      page += 1;
    } while (page <= totalPages);
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(account);
    const token = this.getAccessToken(account);
    const cursorDate = parseDate(cursor);
    const sheets = await this.listSheets(token, config);
    const state = { records: [], rowCount: 0, newest: cursorDate };
    for (const sheet of sheets) {
      await this.listSheetRows(sheet, token, config, cursorDate, state);
    }
    return {
      records: state.records,
      nextCursor: state.newest ? state.newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: { source: 'smartsheet_api', projects: sheets.length, items: state.records.length }
    };
  }
}

const smartsheetWorkSignalClient = new SmartsheetWorkSignalClient();

module.exports = smartsheetWorkSignalClient;
module.exports.SmartsheetWorkSignalClient = SmartsheetWorkSignalClient;
