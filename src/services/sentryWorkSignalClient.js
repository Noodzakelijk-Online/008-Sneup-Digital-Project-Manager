const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://sentry.io/api/0';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const parseDate = value => { const parsed = new Date(value); return value && !Number.isNaN(parsed.getTime()) ? parsed : null; };
const validOrganizationSlug = value => /^[a-z0-9][a-z0-9-]{0,62}$/.test(String(value || ''));
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };

const project = item => item?.id && item.slug && item.name ? compact({ id: `project:${item.id}`, sourceType: 'project', projectId: String(item.id), projectSlug: String(item.slug), name: boundedText(item.name, 96), status: item.status, createdAt: item.dateCreated, updatedAt: item.dateCreated }) : null;
const issue = item => item?.id && item.title ? compact({ id: `issue:${item.id}`, sourceType: 'issue', issueId: String(item.id), projectId: item.project?.id ? String(item.project.id) : undefined, projectSlug: item.project?.slug ? String(item.project.slug) : undefined, name: boundedText(item.title), status: item.status, level: item.level, firstSeen: item.firstSeen, lastSeen: item.lastSeen, eventCount: Number.isFinite(Number(item.count)) ? Number(item.count) : undefined, affectedUsers: Number.isFinite(Number(item.userCount)) ? Number(item.userCount) : undefined }) : null;

class SentryWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig() { return { timeout: clamp(process.env.SNEUP_SENTRY_TIMEOUT_MS, 15000, 1000, 60000), maxProjects: clamp(process.env.SNEUP_SENTRY_MAX_PROJECTS, 100, 1, 1000), maxIssues: clamp(process.env.SNEUP_SENTRY_MAX_ISSUES, 1000, 1, 10000), pageSize: clamp(process.env.SNEUP_SENTRY_PAGE_SIZE, 100, 1, 100), cursorLookbackMs: clamp(process.env.SNEUP_SENTRY_CURSOR_LOOKBACK_MS, 60000, 0, 3600000) }; }

  getToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.token || credentials.accessToken || credentials.apiKey; if (!token) { const error = new Error('Sentry auth token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }

  getOrganizationSlug(account) { const organizationSlug = String(account?.metadata?.fields?.organizationSlug || '').trim().toLowerCase(); if (!validOrganizationSlug(organizationSlug)) { const error = new Error('Sentry organization slug is required and must use lowercase letters, numbers, and hyphens only.'); error.statusCode = 400; throw error; } return organizationSlug; }

  request(path, token, config, params) { return this.http.get(`${API_URL}${path}`, { params, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }

  nextCursor(linkHeader, expectedPath) {
    if (!linkHeader) return undefined;
    const next = String(linkHeader).split(/,(?=\s*<)/).find(segment => /(?:^|;)\s*rel\s*=\s*"?next"?/i.test(segment));
    if (!next) { const error = new Error('Sentry returned pagination without a next relation. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
    const results = next.match(/results\s*=\s*"?(true|false)"?/i);
    if (!results) { const error = new Error('Sentry returned an invalid pagination result signal. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
    if (results[1] === 'false') return null;
    const match = next.match(/<([^>]+)>/);
    let url;
    try { url = new URL(match?.[1]); } catch { url = null; }
    const cursor = url?.searchParams.get('cursor');
    const normalizedPath = url?.pathname?.replace(/\/$/, ''); const normalizedExpectedPath = `${new URL(API_URL).pathname}${expectedPath}`.replace(/\/$/, '');
    if (!url || url.protocol !== 'https:' || url.hostname !== 'sentry.io' || url.port || url.username || url.password || normalizedPath !== normalizedExpectedPath || !cursor || cursor.length > 512) { const error = new Error('Sentry returned an unsafe pagination cursor. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
    return cursor;
  }

  async listPages(path, token, config, params, limit, label, sanitize) {
    const records = []; let cursor; let processed = 0;
    while (true) {
      const remaining = limit - processed;
      if (remaining <= 0) { const error = new Error(`Sentry sync reached its configured ${label} limit. Increase the corresponding SNEUP_SENTRY limit before continuing.`); error.statusCode = 413; throw error; }
      const pageSize = Math.min(config.pageSize, remaining);
      const response = await this.request(path, token, config, { ...params, ...(path.endsWith('/issues/') ? { limit: pageSize } : { per_page: pageSize }), ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(response.data) || response.data.length > pageSize) { const error = new Error(`Sentry returned an invalid ${label} page. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
      records.push(...response.data.map(sanitize).filter(Boolean));
      processed += response.data.length;
      const nextCursor = this.nextCursor(response.headers?.link, path);
      if (nextCursor === undefined) {
        if (response.data.length === pageSize) { const error = new Error(`Sentry returned an incomplete ${label} pagination response. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
        return records;
      }
      if (!nextCursor) return records;
      if (processed >= limit) { const error = new Error(`Sentry sync reached its configured ${label} limit. Increase the corresponding SNEUP_SENTRY limit before continuing.`); error.statusCode = 413; throw error; }
      if (response.data.length === 0) { const error = new Error(`Sentry returned an empty ${label} page with more results. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
      cursor = nextCursor;
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const token = this.getToken(account); const organizationSlug = this.getOrganizationSlug(account); const cursorDate = parseDate(cursor); const updatedAfter = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs).toISOString() : undefined; const basePath = `/organizations/${encodeURIComponent(organizationSlug)}`;
    const [projects, issues] = await Promise.all([
      this.listPages(`${basePath}/projects/`, token, config, {}, config.maxProjects, 'project', project),
      this.listPages(`${basePath}/issues/`, token, config, { query: 'is:unresolved', sort: 'date', statsPeriod: '', ...(updatedAfter ? { start: updatedAfter } : {}) }, config.maxIssues, 'issue', issue)
    ]);
    const records = [...projects, ...issues]; const newest = records.reduce((latest, item) => { const updated = parseDate(item.lastSeen || item.updatedAt || item.createdAt || item.firstSeen); return updated && (!latest || updated > latest) ? updated : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'sentry_api', organizationSlug, projects: projects.length, unresolvedIssues: issues.length, contentPolicy: 'project_and_unresolved_issue_metadata_only_no_event_payloads_stack_traces_culprits_owners_tags_users_releases_alerts_or_provider_writes' } };
  }
}

const sentryWorkSignalClient = new SentryWorkSignalClient();
module.exports = sentryWorkSignalClient;
module.exports.SentryWorkSignalClient = SentryWorkSignalClient;
