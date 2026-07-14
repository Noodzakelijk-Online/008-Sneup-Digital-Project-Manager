const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.pagerduty.com';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const parseDate = value => { const parsed = new Date(value); return value && !Number.isNaN(parsed.getTime()) ? parsed : null; };
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const validId = value => /^[A-Z0-9]{7}$/.test(String(value || ''));

const service = item => validId(item?.id) && item.name ? compact({ id: `service:${item.id}`, sourceType: 'service', serviceId: item.id, name: boundedText(item.name, 96), serviceStatus: item.status, createdAt: item.created_at, updatedAt: item.updated_at }) : null;
const incident = item => validId(item?.id) && item.title ? compact({ id: `incident:${item.id}`, sourceType: 'incident', incidentId: item.id, serviceId: validId(item.service?.id) ? item.service.id : undefined, name: boundedText(item.title), status: ['triggered', 'acknowledged'].includes(item.status) ? item.status : undefined, urgency: ['high', 'low'].includes(item.urgency) ? item.urgency : undefined, createdAt: item.created_at, lastStatusChangeAt: item.last_status_change_at, updatedAt: item.updated_at }) : null;

class PagerDutyWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig() { return { timeout: clamp(process.env.SNEUP_PAGERDUTY_TIMEOUT_MS, 15000, 1000, 60000), maxServices: clamp(process.env.SNEUP_PAGERDUTY_MAX_SERVICES, 500, 1, 5000), maxIncidents: clamp(process.env.SNEUP_PAGERDUTY_MAX_INCIDENTS, 2500, 1, 10000), pageSize: clamp(process.env.SNEUP_PAGERDUTY_PAGE_SIZE, 100, 1, 100), cursorLookbackMs: clamp(process.env.SNEUP_PAGERDUTY_CURSOR_LOOKBACK_MS, 60000, 0, 3600000) }; }

  getToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.token || credentials.accessToken || credentials.apiKey; if (!token) { const error = new Error('PagerDuty REST API token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }

  request(path, token, config, params) { return this.http.get(`${API_URL}${path}`, { params, headers: { Accept: 'application/vnd.pagerduty+json;version=2', Authorization: `Token token=${token}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }

  async listPages(path, key, token, config, params, limit, label, sanitize) {
    const records = []; let offset = 0;
    while (true) {
      const remaining = limit - offset;
      if (remaining <= 0) { const error = new Error(`PagerDuty sync reached its configured ${label} limit. Increase the corresponding SNEUP_PAGERDUTY limit before continuing.`); error.statusCode = 413; throw error; }
      const response = await this.request(path, token, config, { ...params, limit: Math.min(config.pageSize, remaining), offset, total: false }); const raw = response.data?.[key]; const more = response.data?.more;
      if (!Array.isArray(raw) || typeof more !== 'boolean' || raw.length > remaining) { const error = new Error(`PagerDuty returned an invalid ${label} page. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
      records.push(...raw.map(sanitize).filter(Boolean)); offset += raw.length;
      if (!more) return records;
      if (offset >= limit) { const error = new Error(`PagerDuty sync reached its configured ${label} limit. Increase the corresponding SNEUP_PAGERDUTY limit before continuing.`); error.statusCode = 413; throw error; }
      if (raw.length === 0) { const error = new Error(`PagerDuty returned an empty ${label} page with more results. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const token = this.getToken(account); const cursorDate = parseDate(cursor); const since = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs).toISOString() : undefined;
    const [services, incidents] = await Promise.all([
      this.listPages('/services', 'services', token, config, { sort_by: 'name' }, config.maxServices, 'service', service),
      this.listPages('/incidents', 'incidents', token, config, { 'statuses[]': ['triggered', 'acknowledged'], sort_by: 'created_at:desc', ...(since ? { since } : {}) }, config.maxIncidents, 'incident', incident)
    ]);
    const records = [...services, ...incidents]; const newest = records.reduce((latest, item) => { const updated = parseDate(item.lastStatusChangeAt || item.updatedAt || item.createdAt); return updated && (!latest || updated > latest) ? updated : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'pagerduty_api', services: services.length, activeIncidents: incidents.length, contentPolicy: 'active_incident_and_service_metadata_only_no_responders_escalation_policies_schedules_notes_integrations_or_provider_writes' } };
  }
}

const pagerDutyWorkSignalClient = new PagerDutyWorkSignalClient();
module.exports = pagerDutyWorkSignalClient;
module.exports.PagerDutyWorkSignalClient = PagerDutyWorkSignalClient;
