const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_BASE_URL = 'https://quickbooks.api.intuit.com/v3/company';
const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const parseDate = value => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};
const safeInvoiceId = value => /^\d{1,32}$/.test(String(value || '')) ? String(value) : undefined;
const safeStatus = value => /^[A-Z_]{1,64}$/.test(String(value || '')) ? String(value) : undefined;
const invalidResponse = message => {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
};

class QuickBooksWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_QUICKBOOKS_TIMEOUT_MS, 15000, 1000, 60000),
      maxInvoices: clamp(process.env.SNEUP_QUICKBOOKS_MAX_INVOICES, 100, 1, 500),
      maxResponseBytes: clamp(process.env.SNEUP_QUICKBOOKS_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000),
      cursorLookbackMs: clamp(process.env.SNEUP_QUICKBOOKS_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('QuickBooks access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  getRealmId(account) {
    const realmId = String(account?.metadata?.fields?.quickBooksRealmId || '');
    if (!/^\d{1,32}$/.test(realmId)) {
      const error = new Error('QuickBooks company selection is missing. Reconnect this account to establish the authorized company.');
      error.statusCode = 400;
      throw error;
    }
    return realmId;
  }

  normalizeInvoice(invoice, realmId) {
    const invoiceId = safeInvoiceId(invoice?.Id);
    const status = safeStatus(invoice?.TxnStatus) || 'OPEN';
    const createdAt = parseDate(invoice?.TxnDate);
    const dueAt = parseDate(invoice?.DueDate);
    const updatedAt = parseDate(invoice?.MetaData?.LastUpdatedTime);
    if (!invoiceId || (invoice?.TxnDate && !createdAt) || (invoice?.DueDate && !dueAt) || (invoice?.MetaData?.LastUpdatedTime && !updatedAt)) return null;
    return compact({ id: `sales_invoice:${invoiceId}`, sourceType: 'sales_invoice', invoiceId, realmId, status, dueAt, createdAt, updatedAt });
  }

  isWithinCursor(invoice, cursor, config) {
    if (!cursor) return true;
    const updated = new Date(invoice.updatedAt || invoice.createdAt || 0).getTime();
    return !Number.isFinite(updated) || updated >= cursor.getTime() - config.cursorLookbackMs;
  }

  metadata(salesInvoices) {
    return {
      source: 'quickbooks_sales_invoice_metadata',
      companySelected: true,
      salesInvoices,
      contentPolicy: 'one_selected_quickbooks_company_sales_invoice_status_and_date_metadata_only_no_customers_invoice_numbers_amounts_balances_payments_estimates_expenses_projects_line_items_descriptions_addresses_links_attachments_taxes_or_provider_writes'
    };
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const cursorDate = cursor && !Number.isNaN(new Date(cursor).getTime()) ? new Date(cursor) : null;
    if (cursor && !cursorDate) {
      const error = new Error('QuickBooks work-signal cursor is invalid. Reconnect this account to establish a new cursor.');
      error.statusCode = 400;
      throw error;
    }
    const realmId = this.getRealmId(account);
    const response = await this.http.get(`${API_BASE_URL}/${encodeURIComponent(realmId)}/query`, {
      params: { query: `SELECT * FROM Invoice ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS ${config.maxInvoices + 1}` },
      headers: { Accept: 'application/json', Authorization: `Bearer ${this.getAccessToken(account)}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
    const values = response?.data?.QueryResponse?.Invoice;
    if (values === undefined) return { records: [], nextCursor: cursor || null, hasMore: false, metadata: this.metadata(0) };
    if (!Array.isArray(values)) throw invalidResponse('QuickBooks returned an invalid sales-invoice collection. Reconnect this account before syncing again.');
    if (values.length > config.maxInvoices) {
      const error = new Error('QuickBooks sync reached its configured sales-invoice limit before collection completion. Increase SNEUP_QUICKBOOKS_MAX_INVOICES before continuing.');
      error.statusCode = 413;
      throw error;
    }
    const records = values.map(invoice => this.normalizeInvoice(invoice, realmId)).filter(Boolean).filter(invoice => this.isWithinCursor(invoice, cursorDate, config));
    const newest = records.reduce((latest, invoice) => {
      const updated = new Date(invoice.updatedAt || invoice.createdAt || 0);
      return !Number.isNaN(updated.getTime()) && (!latest || updated > latest) ? updated : latest;
    }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: this.metadata(records.length) };
  }
}

const quickBooksWorkSignalClient = new QuickBooksWorkSignalClient();
module.exports = quickBooksWorkSignalClient;
module.exports.QuickBooksWorkSignalClient = QuickBooksWorkSignalClient;
