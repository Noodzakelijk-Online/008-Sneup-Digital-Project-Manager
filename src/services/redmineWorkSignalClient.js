const axios = require('axios');
const net = require('net');
const accountConnectorService = require('./accountConnectorService');

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const compactObject = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));

const isPrivateIpv4 = (hostname) => {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
};

const validId = (value) => /^[1-9][0-9]{0,19}$/.test(String(value || ''));

const relationContext = (issue) => {
  const issueId = String(issue.id || '');
  const result = { dependencies: [], blockedBy: [], blocks: [], related: [], duplicates: [] };
  for (const relation of Array.isArray(issue.relations) ? issue.relations : []) {
    const from = String(relation.issue_id || '');
    const to = String(relation.issue_to_id || '');
    const peer = from === issueId ? to : to === issueId ? from : '';
    if (!validId(peer)) continue;
    const type = String(relation.relation_type || '').toLowerCase();
    if (type === 'blocks') {
      (from === issueId ? result.blocks : result.blockedBy).push({ externalId: `issue:${peer}`, relationship: from === issueId ? 'blocks' : 'blocked_by' });
    } else if (type === 'precedes' || type === 'follows') {
      result.dependencies.push({ externalId: `issue:${peer}`, relationship: 'depends_on' });
    } else if (type === 'duplicates' || type === 'duplicated') {
      result.duplicates.push({ externalId: `issue:${peer}`, relationship: 'duplicates' });
    } else {
      result.related.push({ externalId: `issue:${peer}`, relationship: 'relates_to' });
    }
  }
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value.filter((item, index, items) => items.findIndex(candidate => candidate.externalId === item.externalId) === index)]));
};

const sanitizeProject = (project = {}) => {
  if (!validId(project.id) || !project.name) return null;
  return compactObject({
    id: `project:${project.id}`,
    sourceType: 'project',
    projectId: project.id,
    name: project.name,
    identifier: project.identifier,
    status: project.status,
    createdAt: project.created_on,
    updatedAt: project.updated_on
  });
};

const sanitizeIssue = (issue = {}, apiUrl) => {
  if (!validId(issue.id) || !issue.subject) return null;
  return compactObject({
    id: `issue:${issue.id}`,
    sourceType: 'issue',
    issueId: issue.id,
    name: issue.subject,
    status: issue.status?.name,
    priority: issue.priority?.name,
    tracker: issue.tracker?.name,
    project: compactObject({ id: issue.project?.id, name: issue.project?.name }),
    owners: issue.assigned_to?.name ? [issue.assigned_to.name] : [],
    dueAt: issue.due_date,
    createdAt: issue.created_on,
    updatedAt: issue.updated_on,
    url: `${apiUrl}/issues/${issue.id}`,
    ...relationContext(issue)
  });
};

class RedmineWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig(account) {
    return {
      apiUrl: this.getApiUrl(account),
      timeout: clampInteger(process.env.SNEUP_REDMINE_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clampInteger(process.env.SNEUP_REDMINE_MAX_PROJECTS, 100, 1, 500),
      maxIssues: clampInteger(process.env.SNEUP_REDMINE_MAX_ISSUES, 2500, 1, 10000),
      pageSize: clampInteger(process.env.SNEUP_REDMINE_PAGE_SIZE, 100, 1, 100),
      cursorLookbackMs: clampInteger(process.env.SNEUP_REDMINE_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getApiUrl(account) {
    const raw = String(account?.metadata?.fields?.baseUrl || '').trim();
    let url;
    try {
      url = new URL(raw);
    } catch {
      url = null;
    }
    const hostname = url?.hostname?.toLowerCase() || '';
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
      || !hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
      || net.isIP(hostname) === 6 || isPrivateIpv4(hostname)) {
      const error = new Error('Redmine base URL must be a public HTTPS URL without credentials or a custom port.');
      error.statusCode = 400;
      throw error;
    }
    return url.toString().replace(/\/$/, '');
  }

  getApiKey(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const apiKey = credentials.apiKey || credentials.token || credentials.accessToken;
    if (!apiKey) {
      const error = new Error('Redmine API key is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return apiKey;
  }

  request(config, path, apiKey, params) {
    return this.http.get(`${config.apiUrl}${path}`, {
      params,
      timeout: config.timeout,
      maxRedirects: 0,
      proxy: false,
      headers: {
        Accept: 'application/json',
        'X-Redmine-API-Key': apiKey
      }
    });
  }

  async listCollection(config, apiKey, { path, key, limit, label, params, sanitize }) {
    const records = [];
    let offset = 0;
    while (true) {
      const remaining = limit - offset;
      if (remaining <= 0) {
        const error = new Error(`Redmine sync reached its configured ${label} limit. Increase the corresponding SNEUP_REDMINE limit before continuing.`);
        error.statusCode = 413;
        throw error;
      }
      const response = await this.request(config, path, apiKey, {
        ...params,
        limit: Math.min(config.pageSize, remaining),
        offset
      });
      const page = Array.isArray(response.data?.[key]) ? response.data[key] : [];
      const total = Number(response.data?.total_count);
      if (Number.isFinite(total) && total > limit) {
        const error = new Error(`Redmine sync reached its configured ${label} limit. Increase the corresponding SNEUP_REDMINE limit before continuing.`);
        error.statusCode = 413;
        throw error;
      }
      if (page.length > remaining) {
        const error = new Error(`Redmine returned more ${label} than Sneup is configured to process. Reconnect this account before syncing again.`);
        error.statusCode = 502;
        throw error;
      }
      records.push(...page.map(item => sanitize(item)).filter(Boolean));
      const hasMore = Number.isFinite(total) ? offset + page.length < total : page.length === Math.min(config.pageSize, remaining);
      if (!hasMore) return records;
      if (page.length === 0) {
        const error = new Error(`Redmine returned an incomplete ${label} page. Reconnect this account before syncing again.`);
        error.statusCode = 502;
        throw error;
      }
      offset += page.length;
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(account);
    const apiKey = this.getApiKey(account);
    const cursorDate = parseDate(cursor);
    const updatedAfter = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs).toISOString() : null;
    const projects = await this.listCollection(config, apiKey, {
      path: '/projects.json', key: 'projects', limit: config.maxProjects, label: 'project', params: {}, sanitize: sanitizeProject
    });
    const issues = await this.listCollection(config, apiKey, {
      path: '/issues.json', key: 'issues', limit: config.maxIssues, label: 'issue',
      params: { status_id: '*', sort: 'updated_on:desc', include: 'relations', ...(updatedAfter ? { updated_on: `>=${updatedAfter}` } : {}) },
      sanitize: issue => sanitizeIssue(issue, config.apiUrl)
    });
    const records = [...projects, ...issues];
    const newest = records.reduce((latest, record) => {
      const date = parseDate(record.updatedAt || record.createdAt);
      return date && (!latest || date > latest) ? date : latest;
    }, cursorDate);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'redmine_api',
        projects: projects.length,
        issues: issues.length,
        contentPolicy: 'project_issue_metadata_only_no_descriptions_journals_custom_fields_or_attachments'
      }
    };
  }
}

const redmineWorkSignalClient = new RedmineWorkSignalClient();

module.exports = redmineWorkSignalClient;
module.exports.RedmineWorkSignalClient = RedmineWorkSignalClient;
