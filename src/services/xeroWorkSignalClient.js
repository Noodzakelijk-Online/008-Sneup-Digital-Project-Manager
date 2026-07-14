const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const XERO_API_URL = 'https://api.xero.com/api.xro/2.0';
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ALLOWED_STATUSES = new Set(['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID', 'VOIDED']);
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
const invalidResponse = message => {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
};

const invoiceRecord = (invoice, tenantId) => {
  const invoiceId = String(invoice?.InvoiceID || '').toLowerCase();
  const status = String(invoice?.Status || '').toUpperCase();
  const createdAt = parseDate(invoice?.Date);
  const dueAt = parseDate(invoice?.DueDate);
  const updatedAt = parseDate(invoice?.UpdatedDateUTC);
  if (!UUID_PATTERN.test(invoiceId) || invoice?.Type !== 'ACCREC' || !ALLOWED_STATUSES.has(status) || (invoice?.Date && !createdAt) || (invoice?.DueDate && !dueAt) || (invoice?.UpdatedDateUTC && !updatedAt)) return null;
  return compact({
    id: `sales_invoice:${invoiceId}`,
    sourceType: 'sales_invoice',
    invoiceId,
    tenantId,
    status,
    dueAt,
    createdAt,
    updatedAt
  });
};

class XeroWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_XERO_TIMEOUT_MS, 15000, 1000, 60000),
      maxInvoices: clamp(process.env.SNEUP_XERO_MAX_INVOICES, 100, 1, 100),
      maxResponseBytes: clamp(process.env.SNEUP_XERO_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000),
      cursorLookbackMs: clamp(process.env.SNEUP_XERO_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('Xero access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  getTenantId(account) {
    const tenantId = String(account?.metadata?.fields?.xeroTenantId || '').toLowerCase();
    if (!UUID_PATTERN.test(tenantId)) {
      const error = new Error('Select one authorized Xero organisation before syncing.');
      error.statusCode = 400;
      throw error;
    }
    return tenantId;
  }

  isWithinCursor(invoice, cursor, config) {
    if (!cursor) return true;
    const updated = new Date(invoice.updatedAt || invoice.createdAt || 0).getTime();
    return !Number.isFinite(updated) || updated >= cursor.getTime() - config.cursorLookbackMs;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const cursorDate = cursor && !Number.isNaN(new Date(cursor).getTime()) ? new Date(cursor) : null;
    if (cursor && !cursorDate) {
      const error = new Error('Xero work-signal cursor is invalid. Reconnect this account to establish a new cursor.');
      error.statusCode = 400;
      throw error;
    }
    const token = this.getAccessToken(account);
    const tenantId = this.getTenantId(account);
    const response = await this.http.get(`${XERO_API_URL}/Invoices`, {
      params: { page: 1, where: 'Type=="ACCREC"', order: 'UpdatedDateUTC DESC' },
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'xero-tenant-id': tenantId
      },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
    const values = response?.data?.Invoices;
    if (!Array.isArray(values)) throw invalidResponse('Xero returned an invalid sales-invoice collection. Reconnect this account before syncing again.');
    if (values.length >= config.maxInvoices) {
      const error = new Error('Xero sync reached its configured sales-invoice limit before collection completion. Increase SNEUP_XERO_MAX_INVOICES before continuing.');
      error.statusCode = 413;
      throw error;
    }

    const records = values
      .map(invoice => invoiceRecord(invoice, tenantId))
      .filter(Boolean)
      .filter(invoice => this.isWithinCursor(invoice, cursorDate, config));
    const newest = records.reduce((latest, invoice) => {
      const updated = new Date(invoice.updatedAt || invoice.createdAt || 0);
      return !Number.isNaN(updated.getTime()) && (!latest || updated > latest) ? updated : latest;
    }, cursorDate);

    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'xero_sales_invoice_metadata',
        tenantSelected: true,
        salesInvoices: records.length,
        contentPolicy: 'one_selected_xero_organisation_sales_invoice_status_and_date_metadata_only_no_contacts_invoice_numbers_amounts_payments_descriptions_line_items_urls_or_provider_writes'
      }
    };
  }
}

const xeroWorkSignalClient = new XeroWorkSignalClient();
module.exports = xeroWorkSignalClient;
module.exports.XeroWorkSignalClient = XeroWorkSignalClient;
