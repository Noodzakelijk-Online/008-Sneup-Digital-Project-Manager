const axios = require('axios');
const net = require('net');
const accountConnectorService = require('./accountConnectorService');

const ISSUE_FIELDS = 'id,idReadable,summary,created,updated,resolved,project(id,name)';
const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const isPrivateIpv4 = (hostname) => {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
};
const text = (value) => String(value || '').trim();
const sanitizeIssue = (issue, baseUrl) => {
  const id = text(issue.id);
  const idReadable = text(issue.idReadable);
  const title = text(issue.summary);
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id) || !/^[A-Za-z0-9_-]{1,200}$/.test(idReadable) || !title) return null;
  return {
    id: `issue:${id}`, sourceType: 'issue', issueId: id, issueKey: idReadable, name: title,
    project: issue.project?.id && issue.project?.name ? { id: text(issue.project.id), name: text(issue.project.name) } : undefined,
    resolvedAt: issue.resolved || undefined,
    createdAt: issue.created, updatedAt: issue.updated || issue.created,
    url: `${baseUrl}/issue/${encodeURIComponent(idReadable)}`
  };
};

class YouTrackWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig(account) {
    return {
      apiUrl: this.getApiUrl(account), timeout: clampInteger(process.env.SNEUP_YOUTRACK_TIMEOUT_MS, 15000, 1000, 60000),
      maxIssues: clampInteger(process.env.SNEUP_YOUTRACK_MAX_ISSUES, 2500, 1, 10000),
      pageSize: clampInteger(process.env.SNEUP_YOUTRACK_PAGE_SIZE, 100, 1, 500),
      cursorLookbackMs: clampInteger(process.env.SNEUP_YOUTRACK_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getApiUrl(account) {
    const raw = text(account?.metadata?.fields?.baseUrl);
    let url;
    try { url = new URL(raw); } catch { url = null; }
    const hostname = url?.hostname?.toLowerCase() || '';
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !hostname
      || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || net.isIP(hostname) === 6 || isPrivateIpv4(hostname)) {
      const error = new Error('YouTrack base URL must be a public HTTPS URL without credentials or a custom port.');
      error.statusCode = 400;
      throw error;
    }
    return url.toString().replace(/\/$/, '');
  }

  getToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.apiKey || credentials.accessToken;
    if (!token) { const error = new Error('YouTrack permanent token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; }
    return token;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(account); const token = this.getToken(account); const cursorDate = parseDate(cursor);
    const records = []; let fetched = 0; let skip = 0;
    while (true) {
      const remaining = config.maxIssues - fetched;
      if (remaining <= 0) { const error = new Error('YouTrack sync reached its configured issue limit. Increase SNEUP_YOUTRACK_MAX_ISSUES before continuing.'); error.statusCode = 413; throw error; }
      const response = await this.http.get(`${config.apiUrl}/api/issues`, {
        params: { fields: ISSUE_FIELDS, '$top': Math.min(config.pageSize, remaining), '$skip': skip },
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, timeout: config.timeout, maxRedirects: 0, proxy: false
      });
      const page = Array.isArray(response.data) ? response.data : [];
      if (page.length > remaining) { const error = new Error('YouTrack returned more issues than Sneup is configured to process. Reconnect this account before syncing again.'); error.statusCode = 502; throw error; }
      fetched += page.length;
      records.push(...page.map(issue => sanitizeIssue(issue, config.apiUrl)).filter(Boolean).filter(issue => {
        const updatedAt = parseDate(issue.updatedAt || issue.createdAt);
        return !cursorDate || !updatedAt || updatedAt >= new Date(cursorDate.getTime() - config.cursorLookbackMs);
      }));
      if (page.length < Math.min(config.pageSize, remaining)) break;
      if (fetched >= config.maxIssues) { const error = new Error('YouTrack sync reached its configured issue limit. Increase SNEUP_YOUTRACK_MAX_ISSUES before continuing.'); error.statusCode = 413; throw error; }
      skip += page.length;
    }
    const newest = records.reduce((latest, record) => { const updatedAt = parseDate(record.updatedAt || record.createdAt); return updatedAt && (!latest || updatedAt > latest) ? updatedAt : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'youtrack_api', issues: records.length, contentPolicy: 'issue_metadata_only_no_descriptions_comments_attachments_or_custom_field_values' } };
  }
}

const youTrackWorkSignalClient = new YouTrackWorkSignalClient();
module.exports = youTrackWorkSignalClient;
module.exports.YouTrackWorkSignalClient = YouTrackWorkSignalClient;
