const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const OPPORTUNITY_FIELDS = ['Id', 'Name', 'StageName', 'CloseDate', 'CreatedDate', 'LastModifiedDate', 'IsClosed', 'IsWon'];
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const validId = value => /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(String(value || ''));
const parseDate = value => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const dateLiteral = value => value.toISOString().replace(/\.\d{3}Z$/, 'Z');
const opportunity = item => validId(item?.Id) ? compact({
  id: `opportunity:${item.Id}`,
  sourceType: 'opportunity',
  opportunityId: String(item.Id),
  name: boundedText(item.Name) || `Salesforce opportunity ${item.Id}`,
  status: item.IsClosed === true ? (item.IsWon === true ? 'done' : 'archived') : 'open',
  stage: boundedText(item.StageName, 96),
  dueAt: item.CloseDate,
  createdAt: item.CreatedDate,
  updatedAt: item.LastModifiedDate
}) : null;

class SalesforceWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.now = options.now || (() => new Date()); }
  getConfig() { return { timeout: clamp(process.env.SNEUP_SALESFORCE_TIMEOUT_MS, 15000, 1000, 60000), maxOpportunities: clamp(process.env.SNEUP_SALESFORCE_MAX_OPPORTUNITIES, 2500, 1, 10000), batchSize: clamp(process.env.SNEUP_SALESFORCE_BATCH_SIZE, 200, 200, 2000), cursorLookbackMs: clamp(process.env.SNEUP_SALESFORCE_CURSOR_LOOKBACK_MS, 60000, 0, 3600000), initialLookbackDays: clamp(process.env.SNEUP_SALESFORCE_INITIAL_LOOKBACK_DAYS, 30, 1, 90), apiVersion: /^\d{2}\.0$/.test(process.env.SNEUP_SALESFORCE_API_VERSION || '') ? process.env.SNEUP_SALESFORCE_API_VERSION : '60.0' }; }
  getAccessToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const accessToken = credentials.accessToken || credentials.token; if (!accessToken) { const error = new Error('Salesforce OAuth access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return accessToken; }
  getApiUrl(account) { const instanceUrl = account?.metadata?.fields?.instanceUrl; return this.accountConnectorService.validateSalesforceInstanceUrl(instanceUrl); }
  getNextPageUrl(apiUrl, nextRecordsUrl) {
    if (typeof nextRecordsUrl !== 'string' || !/^\/services\/data\/v\d{2}\.0\/query\/[A-Za-z0-9_-]{8,256}$/.test(nextRecordsUrl)) {
      const error = new Error('Salesforce returned an invalid query cursor. Reconnect this account before syncing again.'); error.statusCode = 502; throw error;
    }
    return `${apiUrl}${nextRecordsUrl}`;
  }
  request(url, accessToken, config, params) { return this.http.get(url, { ...(params ? { params } : {}), headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, 'Sforce-Query-Options': `batchSize=${config.batchSize}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }
  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const apiUrl = this.getApiUrl(account); const accessToken = this.getAccessToken(account); const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) { const error = new Error('Salesforce work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const since = new Date((cursorDate ? cursorDate.getTime() - config.cursorLookbackMs : this.now().getTime() - config.initialLookbackDays * 86400000));
    const query = `SELECT ${OPPORTUNITY_FIELDS.join(', ')} FROM Opportunity WHERE LastModifiedDate >= ${dateLiteral(since)} ORDER BY LastModifiedDate ASC`;
    const records = []; let fetched = 0; let pages = 0; let newest = cursorDate; let url = `${apiUrl}/services/data/v${config.apiVersion}/query`; let params = { q: query };
    while (true) {
      const remaining = config.maxOpportunities - fetched; if (remaining <= 0) { const error = new Error('Salesforce sync reached its configured opportunity limit. Increase SNEUP_SALESFORCE_MAX_OPPORTUNITIES before continuing.'); error.statusCode = 413; throw error; }
      const response = await this.request(url, accessToken, config, params); const items = response?.data?.records;
      if (!Array.isArray(items) || items.length > Math.min(config.batchSize, remaining)) { const error = new Error('Salesforce returned an invalid opportunity page. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      const normalized = items.map(opportunity).filter(Boolean); records.push(...normalized); fetched += items.length; pages += 1;
      for (const item of normalized) { const updated = parseDate(item.updatedAt || item.createdAt); if (updated && (!newest || updated > newest)) newest = updated; }
      if (response?.data?.done === true) break;
      if (fetched >= config.maxOpportunities) { const error = new Error('Salesforce sync reached its configured opportunity limit before all pages completed. Increase SNEUP_SALESFORCE_MAX_OPPORTUNITIES before continuing.'); error.statusCode = 413; throw error; }
      url = this.getNextPageUrl(apiUrl, response?.data?.nextRecordsUrl); params = undefined;
    }
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'salesforce_opportunity_query', opportunities: records.length, pages, contentPolicy: 'opportunity_metadata_only_no_accounts_contacts_cases_tasks_events_owners_amounts_currencies_custom_fields_or_provider_writes' } };
  }
}
const salesforceWorkSignalClient = new SalesforceWorkSignalClient();
module.exports = salesforceWorkSignalClient;
module.exports.SalesforceWorkSignalClient = SalesforceWorkSignalClient;
