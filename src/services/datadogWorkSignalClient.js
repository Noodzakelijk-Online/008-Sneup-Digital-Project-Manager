const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const SITES = new Set(['datadoghq.com', 'datadoghq.eu', 'us3.datadoghq.com', 'us5.datadoghq.com', 'ap1.datadoghq.com', 'ap2.datadoghq.com', 'uk1.datadoghq.com', 'ddog-gov.com', 'us2.ddog-gov.com']);
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const parseDate = value => { const parsed = new Date(value); return value && !Number.isNaN(parsed.getTime()) ? parsed : null; };
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const monitorState = value => ['Alert', 'Warn', 'No Data', 'OK'].includes(value) ? value : undefined;
const incidentState = value => ['active', 'stable'].includes(value) ? value : undefined;
const severity = value => /^SEV-[1-5]$/i.test(String(value || '')) ? String(value).toUpperCase() : undefined;

const monitor = item => Number.isFinite(Number(item?.id)) && item.name ? compact({ id: `monitor:${item.id}`, sourceType: 'monitor', monitorId: String(item.id), name: boundedText(item.name, 120), status: monitorState(item.overall_state), monitorType: boundedText(item.type, 64), createdAt: item.created, updatedAt: item.modified }) : null;
const incident = item => { const attributes = item?.attributes || {}; const fields = attributes.fields || {}; const state = incidentState(fields.state?.value || attributes.state); return item?.id && attributes.title && state ? compact({ id: `incident:${item.id}`, sourceType: 'incident', incidentId: String(item.id), name: boundedText(attributes.title), status: state, severity: severity(fields.severity?.value), createdAt: attributes.created, updatedAt: attributes.modified, resolvedAt: attributes.resolved }) : null; };

class DatadogWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }
  getConfig() { return { timeout: clamp(process.env.SNEUP_DATADOG_TIMEOUT_MS, 15000, 1000, 60000), maxMonitors: clamp(process.env.SNEUP_DATADOG_MAX_MONITORS, 1000, 1, 5000), maxIncidents: clamp(process.env.SNEUP_DATADOG_MAX_INCIDENTS, 500, 1, 5000), cursorLookbackMs: clamp(process.env.SNEUP_DATADOG_CURSOR_LOOKBACK_MS, 60000, 0, 3600000) }; }
  getCredentials(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const apiKey = credentials.apiKey; const appKey = credentials.appKey; if (!apiKey || !appKey) { const error = new Error('Datadog API and application keys are required. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return { apiKey, appKey }; }
  getSite(account) { const site = String(account?.metadata?.fields?.site || 'datadoghq.com').trim().toLowerCase(); if (!SITES.has(site)) { const error = new Error('Datadog site must be one of the documented Datadog API sites.'); error.statusCode = 400; throw error; } return site; }
  request(site, path, credentials, config, params) { return this.http.get(`https://api.${site}${path}`, { params, headers: { Accept: 'application/json', 'DD-API-KEY': credentials.apiKey, 'DD-APPLICATION-KEY': credentials.appKey, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }
  validatePage(value, limit, label) { if (!Array.isArray(value) || value.length > limit) { const error = new Error(`Datadog returned an invalid or over-limit ${label} response. Narrow the Datadog account scope before syncing again.`); error.statusCode = value?.length > limit ? 413 : 502; throw error; } return value; }
  async fetchDelta(account, cursor) { const config = this.getConfig(); const credentials = this.getCredentials(account); const site = this.getSite(account); const cursorDate = parseDate(cursor); const [monitorResponse, incidentResponse] = await Promise.all([this.request(site, '/api/v1/monitor', credentials, config), this.request(site, '/api/v2/incidents/search', credentials, config, { query: 'state:(active OR stable)' })]); const monitors = this.validatePage(monitorResponse.data, config.maxMonitors, 'monitor').map(monitor).filter(Boolean); const incidents = this.validatePage(incidentResponse.data?.data, config.maxIncidents, 'incident').map(incident).filter(Boolean); const records = [...monitors, ...incidents]; const newest = records.reduce((latest, item) => { const updated = parseDate(item.updatedAt || item.resolvedAt || item.createdAt); return updated && (!latest || updated > latest) ? updated : latest; }, cursorDate); return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'datadog_api', site, monitors: monitors.length, activeIncidents: incidents.length, contentPolicy: 'monitor_and_active_incident_metadata_only_no_queries_messages_tags_downtimes_dashboards_services_slos_timeline_responders_or_provider_writes' } }; }
}

const datadogWorkSignalClient = new DatadogWorkSignalClient();
module.exports = datadogWorkSignalClient;
module.exports.DatadogWorkSignalClient = DatadogWorkSignalClient;
