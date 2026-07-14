const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.hubapi.com';
const DEAL_PROPERTIES = ['dealname', 'dealstage', 'pipeline', 'closedate', 'createdate', 'hs_lastmodifieddate'];
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const parseDate = value => { if (!value) return null; const date = /^\d{11,16}$/.test(String(value)) ? new Date(Number(value)) : new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const status = value => { const stage = String(value || '').toLowerCase(); return stage.includes('closedwon') ? 'done' : stage.includes('closedlost') ? 'archived' : stage ? 'open' : undefined; };
const deal = item => {
  const properties = item?.properties || {}; const id = String(item?.id || '');
  return validId(id) ? compact({
    id: `deal:${id}`,
    sourceType: 'deal',
    dealId: id,
    name: boundedText(properties.dealname) || `HubSpot deal ${id}`,
    status: status(properties.dealstage),
    dealStage: boundedText(properties.dealstage, 96),
    pipeline: boundedText(properties.pipeline, 96),
    dueAt: properties.closedate,
    createdAt: properties.createdate || item.createdAt,
    updatedAt: properties.hs_lastmodifieddate || item.updatedAt,
    archived: item.archived === true
  }) : null;
};

class HubSpotWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.now = options.now || (() => new Date()); }
  getConfig() { return { timeout: clamp(process.env.SNEUP_HUBSPOT_TIMEOUT_MS, 15000, 1000, 60000), maxDeals: clamp(process.env.SNEUP_HUBSPOT_MAX_DEALS, 2500, 1, 10000), pageSize: clamp(process.env.SNEUP_HUBSPOT_PAGE_SIZE, 100, 1, 200), cursorLookbackMs: clamp(process.env.SNEUP_HUBSPOT_CURSOR_LOOKBACK_MS, 60000, 0, 3600000), initialLookbackDays: clamp(process.env.SNEUP_HUBSPOT_INITIAL_LOOKBACK_DAYS, 30, 1, 90) }; }
  getAccessToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const accessToken = credentials.accessToken || credentials.token; if (!accessToken) { const error = new Error('HubSpot OAuth access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return accessToken; }
  request(accessToken, config, body) { return this.http.post(`${API_URL}/crm/objects/2026-03/deals/search`, body, { headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }
  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const accessToken = this.getAccessToken(account); const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) { const error = new Error('HubSpot work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const initialSince = new Date(this.now().getTime() - config.initialLookbackDays * 86400000); const since = new Date((cursorDate ? cursorDate.getTime() - config.cursorLookbackMs : initialSince.getTime()));
    const records = []; let fetched = 0; let after = null; let pages = 0; let newest = cursorDate;
    while (true) {
      const remaining = config.maxDeals - fetched; if (remaining <= 0) { const error = new Error('HubSpot sync reached its configured deal limit. Increase SNEUP_HUBSPOT_MAX_DEALS before continuing.'); error.statusCode = 413; throw error; }
      const limit = Math.min(config.pageSize, remaining); const body = { filterGroups: [{ filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(since.getTime()) }] }], sorts: ['hs_lastmodifieddate'], properties: DEAL_PROPERTIES, limit, ...(after ? { after } : {}) };
      const response = await this.request(accessToken, config, body); const items = response?.data?.results;
      if (!Array.isArray(items) || items.length > limit) { const error = new Error('HubSpot returned an invalid deal page. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      const normalized = items.map(deal).filter(Boolean); records.push(...normalized); fetched += items.length; pages += 1;
      for (const item of normalized) { const updated = parseDate(item.updatedAt || item.createdAt); if (updated && (!newest || updated > newest)) newest = updated; }
      after = typeof response?.data?.paging?.next?.after === 'string' && response.data.paging.next.after.length <= 2048 ? response.data.paging.next.after : null;
      if (!after) break;
      if (fetched >= config.maxDeals) { const error = new Error('HubSpot sync reached its configured deal limit before all pages completed. Increase SNEUP_HUBSPOT_MAX_DEALS before continuing.'); error.statusCode = 413; throw error; }
    }
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'hubspot_deals_search', deals: records.length, pages, contentPolicy: 'deal_metadata_only_no_contacts_companies_tickets_tasks_notes_associations_owners_amounts_currencies_custom_fields_or_provider_writes' } };
  }
}
const hubSpotWorkSignalClient = new HubSpotWorkSignalClient();
module.exports = hubSpotWorkSignalClient;
module.exports.HubSpotWorkSignalClient = HubSpotWorkSignalClient;
