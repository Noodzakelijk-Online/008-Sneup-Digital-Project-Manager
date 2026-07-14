const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const status = value => ['open', 'won', 'lost'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : undefined;
const cursorFrom = data => {
  const cursor = data?.additional_data?.next_cursor || data?.additional_data?.pagination?.next_cursor;
  return typeof cursor === 'string' && cursor.trim() && cursor.length <= 2048 ? cursor : null;
};
const deal = item => validId(item?.id) ? compact({
  id: `deal:${item.id}`,
  sourceType: 'deal',
  dealId: String(item.id),
  name: boundedText(item.title) || `Pipedrive deal ${item.id}`,
  status: status(item.status),
  pipelineId: validId(item.pipeline_id) ? String(item.pipeline_id) : undefined,
  stageId: validId(item.stage_id) ? String(item.stage_id) : undefined,
  dueAt: item.expected_close_date,
  createdAt: item.add_time,
  updatedAt: item.update_time,
  wonAt: item.won_time,
  lostAt: item.lost_time
}) : null;

class PipedriveWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.now = options.now || (() => new Date()); }
  getConfig() { return { timeout: clamp(process.env.SNEUP_PIPEDRIVE_TIMEOUT_MS, 15000, 1000, 60000), maxDeals: clamp(process.env.SNEUP_PIPEDRIVE_MAX_DEALS, 2500, 1, 10000), pageSize: clamp(process.env.SNEUP_PIPEDRIVE_PAGE_SIZE, 100, 1, 500), initialLookbackDays: clamp(process.env.SNEUP_PIPEDRIVE_INITIAL_LOOKBACK_DAYS, 30, 1, 90) }; }
  getApiUrl(account) { const companyDomain = String(account?.metadata?.fields?.companyDomain || '').trim().toLowerCase(); if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(companyDomain)) { const error = new Error('Pipedrive company domain must use lowercase letters, numbers, and hyphens only.'); error.statusCode = 400; throw error; } return `https://${companyDomain}.pipedrive.com`; }
  getAccessToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const accessToken = credentials.accessToken || credentials.token; if (!accessToken) { const error = new Error('Pipedrive OAuth access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return accessToken; }
  request(apiUrl, accessToken, config, params) { return this.http.get(`${apiUrl}/api/v2/deals`, { params, headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }
  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const apiUrl = this.getApiUrl(account); const accessToken = this.getAccessToken(account);
    if (cursor && (typeof cursor !== 'string' || !cursor.trim() || cursor.length > 2048)) { const error = new Error('Pipedrive work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const records = []; let fetched = 0; let nextCursor = cursor || null; let pages = 0; const updatedSince = new Date(this.now().getTime() - config.initialLookbackDays * 86400000).toISOString();
    while (true) {
      const remaining = config.maxDeals - fetched; if (remaining <= 0) { const error = new Error('Pipedrive sync reached its configured deal limit. Increase SNEUP_PIPEDRIVE_MAX_DEALS before continuing.'); error.statusCode = 413; throw error; }
      const pageSize = Math.min(config.pageSize, remaining); const params = { updated_since: updatedSince, sort_by: 'update_time', sort_direction: 'asc', limit: pageSize }; if (nextCursor) params.cursor = nextCursor;
      const response = await this.request(apiUrl, accessToken, config, params); const items = response?.data?.data;
      if (!Array.isArray(items) || items.length > pageSize) { const error = new Error('Pipedrive returned an invalid deal page. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      records.push(...items.map(deal).filter(Boolean)); fetched += items.length; pages += 1; nextCursor = cursorFrom(response.data);
      if (!nextCursor) break;
      if (fetched >= config.maxDeals) { const error = new Error('Pipedrive sync reached its configured deal limit before all pages completed. Increase SNEUP_PIPEDRIVE_MAX_DEALS before continuing.'); error.statusCode = 413; throw error; }
    }
    return { records, nextCursor, hasMore: false, metadata: { source: 'pipedrive_api_v2_deals', deals: records.length, pages, contentPolicy: 'deal_metadata_only_no_people_organizations_notes_activities_values_currencies_custom_fields_lost_reasons_or_provider_writes' } };
  }
}
const pipedriveWorkSignalClient = new PipedriveWorkSignalClient();
module.exports = pipedriveWorkSignalClient;
module.exports.PipedriveWorkSignalClient = PipedriveWorkSignalClient;
