const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const status = value => ({ 2: 'open', 3: 'pending', 4: 'resolved', 5: 'closed' }[Number(value)]);
const priority = value => ({ 1: 'low', 2: 'normal', 3: 'high', 4: 'urgent' }[Number(value)]);
const ticket = item => validId(item?.id) && item.subject ? compact({ id: `ticket:${item.id}`, sourceType: 'ticket', ticketId: String(item.id), name: boundedText(item.subject), status: status(item.status), priority: priority(item.priority), ticketType: ['question', 'incident', 'problem', 'feature_request'].includes(String(item.type || '').toLowerCase()) ? String(item.type).toLowerCase() : undefined, groupId: validId(item.group_id) ? String(item.group_id) : undefined, dueAt: item.due_by, createdAt: item.created_at, updatedAt: item.updated_at }) : null;

class FreshdeskWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.now = options.now || (() => new Date()); }
  getConfig() { return { timeout: clamp(process.env.SNEUP_FRESHDESK_TIMEOUT_MS, 15000, 1000, 60000), maxTickets: clamp(process.env.SNEUP_FRESHDESK_MAX_TICKETS, 2500, 1, 10000), pageSize: clamp(process.env.SNEUP_FRESHDESK_PAGE_SIZE, 100, 1, 100), cursorLookbackMs: clamp(process.env.SNEUP_FRESHDESK_CURSOR_LOOKBACK_MS, 60000, 0, 3600000), initialLookbackDays: clamp(process.env.SNEUP_FRESHDESK_INITIAL_LOOKBACK_DAYS, 30, 1, 90) }; }
  getApiUrl(account) { const subdomain = String(account?.metadata?.fields?.subdomain || '').trim().toLowerCase(); if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) { const error = new Error('Freshdesk subdomain must use lowercase letters, numbers, and hyphens only.'); error.statusCode = 400; throw error; } return `https://${subdomain}.freshdesk.com`; }
  getApiKey(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const apiKey = credentials.apiKey || credentials.token || credentials.accessToken; if (!apiKey) { const error = new Error('Freshdesk API key is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return apiKey; }
  request(apiUrl, apiKey, config, params) { return this.http.get(`${apiUrl}/api/v2/tickets`, { params, auth: { username: apiKey, password: 'X' }, headers: { Accept: 'application/json', 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }
  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const apiUrl = this.getApiUrl(account); const apiKey = this.getApiKey(account); const cursorDate = cursor ? new Date(cursor) : null;
    if (cursor && Number.isNaN(cursorDate.getTime())) { const error = new Error('Freshdesk work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const updatedSince = new Date((cursorDate ? cursorDate.getTime() - config.cursorLookbackMs : this.now().getTime() - config.initialLookbackDays * 86400000)).toISOString(); const records = []; let fetched = 0; let page = 1;
    while (true) {
      const remaining = config.maxTickets - fetched; if (remaining <= 0) { const error = new Error('Freshdesk sync reached its configured ticket limit. Increase SNEUP_FRESHDESK_MAX_TICKETS before continuing.'); error.statusCode = 413; throw error; }
      const pageSize = Math.min(config.pageSize, remaining); const response = await this.request(apiUrl, apiKey, config, { updated_since: updatedSince, order_by: 'updated_at', order_type: 'asc', page, per_page: pageSize }); const items = response.data;
      if (!Array.isArray(items) || items.length > pageSize) { const error = new Error('Freshdesk returned an invalid ticket page. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      records.push(...items.map(ticket).filter(Boolean)); fetched += items.length;
      if (items.length < pageSize) break;
      if (fetched >= config.maxTickets) { const error = new Error('Freshdesk sync reached its configured ticket limit before all pages completed. Increase SNEUP_FRESHDESK_MAX_TICKETS before continuing.'); error.statusCode = 413; throw error; }
      page += 1;
    }
    const newest = records.reduce((latest, item) => { const date = new Date(item.updatedAt || item.createdAt); return !Number.isNaN(date.getTime()) && (!latest || date > latest) ? date : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'freshdesk_api', tickets: records.length, pages: page, contentPolicy: 'ticket_metadata_only_no_descriptions_contacts_companies_agents_comments_tags_custom_fields_attachments_or_provider_writes' } };
  }
}
const freshdeskWorkSignalClient = new FreshdeskWorkSignalClient();
module.exports = freshdeskWorkSignalClient;
module.exports.FreshdeskWorkSignalClient = FreshdeskWorkSignalClient;
