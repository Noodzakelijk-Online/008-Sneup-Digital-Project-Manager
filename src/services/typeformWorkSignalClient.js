const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.typeform.com';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const validId = value => /^[A-Za-z0-9_-]{4,128}$/.test(String(value || ''));
const parseDate = value => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const form = item => validId(item?.id) ? compact({ id: `form:${item.id}`, sourceType: 'form', formId: String(item.id), name: boundedText(item.title) || `Typeform ${item.id}`, status: 'open', workspaceId: validId(item.workspace?.id) ? String(item.workspace.id) : undefined, createdAt: item.created_at, updatedAt: item.last_updated_at || item.updated_at }) : null;

class TypeformWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.now = options.now || (() => new Date()); }
  getConfig() { return { timeout: clamp(process.env.SNEUP_TYPEFORM_TIMEOUT_MS, 15000, 1000, 60000), maxForms: clamp(process.env.SNEUP_TYPEFORM_MAX_FORMS, 500, 1, 2500), pageSize: clamp(process.env.SNEUP_TYPEFORM_PAGE_SIZE, 200, 1, 200), cursorLookbackMs: clamp(process.env.SNEUP_TYPEFORM_CURSOR_LOOKBACK_MS, 60000, 0, 3600000), initialLookbackDays: clamp(process.env.SNEUP_TYPEFORM_INITIAL_LOOKBACK_DAYS, 30, 1, 90) }; }
  getAccessToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.token || credentials.accessToken || credentials.apiKey; if (!token) { const error = new Error('Typeform personal access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }
  request(token, config, params) { return this.http.get(`${API_URL}/forms`, { params, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }
  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const token = this.getAccessToken(account); const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) { const error = new Error('Typeform work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const threshold = new Date((cursorDate ? cursorDate.getTime() - config.cursorLookbackMs : this.now().getTime() - config.initialLookbackDays * 86400000)); const records = []; let fetched = 0; let page = 1; let newest = cursorDate;
    while (true) {
      const remaining = config.maxForms - fetched; if (remaining <= 0) { const error = new Error('Typeform sync reached its configured form limit. Increase SNEUP_TYPEFORM_MAX_FORMS before continuing.'); error.statusCode = 413; throw error; }
      const pageSize = Math.min(config.pageSize, remaining); const response = await this.request(token, config, { page_size: pageSize, page }); const items = response?.data?.items;
      if (!Array.isArray(items) || items.length > pageSize) { const error = new Error('Typeform returned an invalid form page. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      const normalized = items.map(form).filter(Boolean); fetched += items.length; page += 1;
      for (const item of normalized) { const updated = parseDate(item.updatedAt || item.createdAt); if (!updated || updated >= threshold) { records.push(item); if (updated && (!newest || updated > newest)) newest = updated; } }
      if (items.length < pageSize) break;
      if (fetched >= config.maxForms) { const error = new Error('Typeform sync reached its configured form limit before all pages completed. Increase SNEUP_TYPEFORM_MAX_FORMS before continuing.'); error.statusCode = 413; throw error; }
    }
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'typeform_forms_api', forms: records.length, pages: page - 1, contentPolicy: 'form_metadata_only_no_responses_questions_fields_logic_hidden_parameters_webhooks_workspace_members_or_provider_writes' } };
  }
}
const typeformWorkSignalClient = new TypeformWorkSignalClient();
module.exports = typeformWorkSignalClient;
module.exports.TypeformWorkSignalClient = TypeformWorkSignalClient;
