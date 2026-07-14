const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.statuspage.io/v1';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const parseDate = value => { const parsed = new Date(value); return value && !Number.isNaN(parsed.getTime()) ? parsed : null; };
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const validPageId = value => /^[a-z0-9]{6,64}$/.test(String(value || ''));
const validItemId = value => /^[A-Za-z0-9_-]{1,128}$/.test(String(value || ''));
const componentStatus = value => ['operational', 'degraded_performance', 'partial_outage', 'major_outage', 'under_maintenance'].includes(value) ? value : undefined;
const incidentStatus = value => ['investigating', 'identified', 'monitoring', 'resolved'].includes(value) ? value : undefined;
const incidentImpact = value => ['none', 'minor', 'major', 'critical', 'maintenance', 'unknown'].includes(value) ? value : undefined;

const component = item => validItemId(item?.id) && item.name ? compact({ id: `component:${item.id}`, sourceType: 'component', componentId: item.id, name: boundedText(item.name, 96), status: componentStatus(item.status), createdAt: item.created_at, updatedAt: item.updated_at }) : null;
const incident = item => validItemId(item?.id) && item.name ? compact({ id: `incident:${item.id}`, sourceType: 'incident', incidentId: item.id, name: boundedText(item.name), status: incidentStatus(item.status), impact: incidentImpact(item.impact), componentIds: Array.isArray(item.components) ? item.components.map(value => validItemId(value?.id || value) ? String(value.id || value) : null).filter(Boolean).slice(0, 100) : undefined, createdAt: item.created_at, updatedAt: item.updated_at, resolvedAt: item.resolved_at }) : null;

class StatuspageWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig() { return { timeout: clamp(process.env.SNEUP_STATUSPAGE_TIMEOUT_MS, 15000, 1000, 60000), maxComponents: clamp(process.env.SNEUP_STATUSPAGE_MAX_COMPONENTS, 500, 1, 5000), maxIncidents: clamp(process.env.SNEUP_STATUSPAGE_MAX_INCIDENTS, 500, 1, 5000), pageSize: clamp(process.env.SNEUP_STATUSPAGE_PAGE_SIZE, 100, 1, 100), cursorLookbackMs: clamp(process.env.SNEUP_STATUSPAGE_CURSOR_LOOKBACK_MS, 60000, 0, 3600000) }; }

  getApiKey(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const apiKey = credentials.apiKey || credentials.token || credentials.accessToken; if (!apiKey) { const error = new Error('Statuspage API key is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return apiKey; }

  getPageId(account) { const pageId = String(account?.metadata?.fields?.pageId || '').trim().toLowerCase(); if (!validPageId(pageId)) { const error = new Error('Statuspage page ID is required and must use lowercase letters and numbers only.'); error.statusCode = 400; throw error; } return pageId; }

  request(path, apiKey, config, params) { return this.http.get(`${API_URL}${path}`, { params, headers: { Accept: 'application/json', Authorization: `OAuth ${apiKey}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }

  async listPages(path, apiKey, config, limit, label, sanitize, paramsForPage) {
    const records = []; let page = 1; let processed = 0;
    while (true) {
      const remaining = limit - processed;
      if (remaining <= 0) { const error = new Error(`Statuspage sync reached its configured ${label} limit. Increase the corresponding SNEUP_STATUSPAGE limit before continuing.`); error.statusCode = 413; throw error; }
      const pageSize = Math.min(config.pageSize, remaining); const response = await this.request(path, apiKey, config, paramsForPage(page, pageSize));
      if (!Array.isArray(response.data) || response.data.length > pageSize) { const error = new Error(`Statuspage returned an invalid ${label} page. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
      records.push(...response.data.map(sanitize).filter(Boolean)); processed += response.data.length;
      if (response.data.length < pageSize) return records;
      if (processed >= limit) { const error = new Error(`Statuspage sync reached its configured ${label} limit. Increase the corresponding SNEUP_STATUSPAGE limit before continuing.`); error.statusCode = 413; throw error; }
      page += 1;
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const apiKey = this.getApiKey(account); const pageId = this.getPageId(account); const cursorDate = parseDate(cursor); const basePath = `/pages/${encodeURIComponent(pageId)}`;
    const [components, incidents] = await Promise.all([
      this.listPages(`${basePath}/components`, apiKey, config, config.maxComponents, 'component', component, (page, pageSize) => ({ page, per_page: pageSize })),
      this.listPages(`${basePath}/incidents`, apiKey, config, config.maxIncidents, 'incident', incident, (page, pageSize) => ({ page, limit: pageSize }))
    ]);
    const records = [...components, ...incidents]; const newest = records.reduce((latest, item) => { const updated = parseDate(item.updatedAt || item.resolvedAt || item.createdAt); return updated && (!latest || updated > latest) ? updated : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'statuspage_api', pageId, components: components.length, incidents: incidents.length, contentPolicy: 'component_and_incident_metadata_only_no_subscribers_incident_updates_postmortems_component_descriptions_or_provider_writes' } };
  }
}

const statuspageWorkSignalClient = new StatuspageWorkSignalClient();
module.exports = statuspageWorkSignalClient;
module.exports.StatuspageWorkSignalClient = StatuspageWorkSignalClient;
