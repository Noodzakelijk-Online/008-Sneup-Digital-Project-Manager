const axios = require('axios');
const net = require('net');
const accountConnectorService = require('./accountConnectorService');
const clamp = (v, fallback, min, max) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; };
const date = value => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed; };
const privateIpv4 = host => { const p = host.split('.').map(Number); return p.length === 4 && p.every(n => Number.isInteger(n) && n >= 0 && n <= 255) && (p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168)); };
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const project = item => validId(item?.id) && item.name ? compact({ id: `project:${item.id}`, sourceType: 'project', projectId: item.id, name: item.name, projectKey: item.projectKey, archived: item.archived === true }) : null;
const issue = (item, projects, apiUrl) => validId(item?.id) && item.summary ? compact({ id: `issue:${item.id}`, sourceType: 'issue', issueId: item.id, issueKey: item.issueKey, name: item.summary, project: projects.get(String(item.projectId)), status: item.status?.name, priority: item.priority?.name, issueType: item.issueType?.name, owners: item.assignee?.name ? [item.assignee.name] : [], dueAt: item.dueDate, createdAt: item.created, updatedAt: item.updated || item.created, url: `${apiUrl.replace('/api/v2', '')}/view/${encodeURIComponent(item.issueKey || item.id)}` }) : null;

class BacklogWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }
  getConfig(account) { return { apiUrl: this.getApiUrl(account), timeout: clamp(process.env.SNEUP_BACKLOG_TIMEOUT_MS, 15000, 1000, 60000), maxProjects: clamp(process.env.SNEUP_BACKLOG_MAX_PROJECTS, 100, 1, 500), maxIssues: clamp(process.env.SNEUP_BACKLOG_MAX_ISSUES, 2500, 1, 10000), pageSize: clamp(process.env.SNEUP_BACKLOG_PAGE_SIZE, 100, 1, 100), lookback: clamp(process.env.SNEUP_BACKLOG_CURSOR_LOOKBACK_MS, 60000, 0, 3600000) }; }
  getApiUrl(account) {
    const raw = String(account?.metadata?.fields?.spaceUrl || account?.metadata?.fields?.spaceId || '').trim(); let url;
    try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}.backlog.com`); } catch { url = null; }
    const host = url?.hostname?.toLowerCase() || '';
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !['/', '/api/v2', '/api/v2/'].includes(url.pathname) || !(/^[a-z0-9][a-z0-9-]*\.backlog(?:tool)?\.com$/.test(host)) || net.isIP(host) === 6 || privateIpv4(host)) { const error = new Error('Backlog space URL must be a public HTTPS *.backlog.com or *.backlogtool.com URL without credentials or a custom port.'); error.statusCode = 400; throw error; }
    return `${url.origin}/api/v2`;
  }
  getKey(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const key = credentials.apiKey || credentials.token || credentials.accessToken; if (!key) { const error = new Error('Backlog API key is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return key; }
  request(config, key, path, params) { return this.http.get(`${config.apiUrl}${path}`, { params: { ...params, apiKey: key }, headers: { Accept: 'application/json' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }
  async fetchDelta(account, cursor) {
    const config = this.getConfig(account); const key = this.getKey(account); const cursorDate = cursor ? date(cursor) : null;
    const projectResponse = await this.request(config, key, '/projects', { archived: false, all: false }); const rawProjects = Array.isArray(projectResponse.data) ? projectResponse.data : [];
    if (rawProjects.length > config.maxProjects) { const error = new Error('Backlog sync reached its configured project limit. Increase SNEUP_BACKLOG_MAX_PROJECTS before continuing.'); error.statusCode = 413; throw error; }
    const projects = rawProjects.map(project).filter(Boolean); const projectMap = new Map(projects.map(item => [String(item.projectId), { id: item.projectId, name: item.name, projectKey: item.projectKey }])); const issues = []; let fetched = 0;
    for (const item of projects) {
      const countResponse = await this.request(config, key, '/issues/count', { 'projectId[]': item.projectId }); const total = Number(countResponse.data?.count);
      if (Number.isFinite(total) && total > config.maxIssues - fetched) { const error = new Error('Backlog sync reached its configured issue limit. Increase SNEUP_BACKLOG_MAX_ISSUES before continuing.'); error.statusCode = 413; throw error; }
      for (let offset = 0; ; offset += config.pageSize) { const remaining = config.maxIssues - fetched; if (remaining <= 0) { const error = new Error('Backlog sync reached its configured issue limit. Increase SNEUP_BACKLOG_MAX_ISSUES before continuing.'); error.statusCode = 413; throw error; } const response = await this.request(config, key, '/issues', { 'projectId[]': item.projectId, sort: 'updated', order: 'desc', offset, count: Math.min(config.pageSize, remaining) }); const page = Array.isArray(response.data) ? response.data : []; if (page.length > remaining) { const error = new Error('Backlog returned more issues than Sneup is configured to process. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; } fetched += page.length; issues.push(...page.map(value => issue(value, projectMap, config.apiUrl)).filter(Boolean)); if (page.length < Math.min(config.pageSize, remaining)) break; if (fetched >= config.maxIssues) { const error = new Error('Backlog sync reached its configured issue limit. Increase SNEUP_BACKLOG_MAX_ISSUES before continuing.'); error.statusCode = 413; throw error; } }
    }
    const records = [...projects, ...issues].filter(item => !cursorDate || !date(item.updatedAt || item.createdAt) || date(item.updatedAt || item.createdAt) >= new Date(cursorDate.getTime() - config.lookback)); const newest = records.reduce((latest, item) => { const value = date(item.updatedAt || item.createdAt); return value && (!latest || value > latest) ? value : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'backlog_api', projects: projects.length, issues: issues.length, contentPolicy: 'project_issue_metadata_only_no_descriptions_comments_attachments_custom_fields_or_provider_writes' } };
  }
}
const backlogWorkSignalClient = new BacklogWorkSignalClient();
module.exports = backlogWorkSignalClient; module.exports.BacklogWorkSignalClient = BacklogWorkSignalClient;
