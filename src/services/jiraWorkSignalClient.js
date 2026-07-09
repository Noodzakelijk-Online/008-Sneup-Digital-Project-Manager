const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const DEFAULT_API_URL = 'https://api.atlassian.com';
const DEFAULT_MAX_ISSUES = 1000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_CURSOR_LOOKBACK_MS = 60000;

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

const parseCursor = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatJqlDate = (date) => date.toISOString().slice(0, 16).replace('T', ' ');

class JiraWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      apiUrl: String(process.env.SNEUP_JIRA_API_URL || DEFAULT_API_URL).replace(/\/$/, ''),
      timeout: clampInteger(process.env.SNEUP_JIRA_TIMEOUT_MS, 15000, 1000, 60000),
      maxIssues: clampInteger(process.env.SNEUP_JIRA_MAX_ISSUES, DEFAULT_MAX_ISSUES, 1, 5000),
      pageSize: clampInteger(process.env.SNEUP_JIRA_PAGE_SIZE, DEFAULT_PAGE_SIZE, 1, 100),
      cursorLookbackMs: clampInteger(process.env.SNEUP_JIRA_CURSOR_LOOKBACK_MS, DEFAULT_CURSOR_LOOKBACK_MS, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('Jira access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  getCloudId(account) {
    return String(account?.metadata?.fields?.cloudId || account?.metadata?.jiraCloudId || '').trim();
  }

  async listAccessibleResources(token, config) {
    const response = await this.http.get(`${config.apiUrl}/oauth/token/accessible-resources`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      },
      timeout: config.timeout
    });

    return (Array.isArray(response.data) ? response.data : [])
      .filter(resource => resource?.id)
      .filter(resource => (resource.scopes || []).some(scope => String(scope).startsWith('read:jira') || scope === 'read:servicedesk-data'));
  }

  selectResource(account, resources) {
    const requestedCloudId = this.getCloudId(account);
    if (requestedCloudId) {
      const selected = resources.find(resource => resource.id === requestedCloudId);
      if (!selected) {
        const error = new Error('The configured Jira cloud ID is not available to this account. Reconnect or select an authorized site.');
        error.statusCode = 403;
        throw error;
      }
      return selected;
    }

    if (resources.length === 1) return resources[0];
    if (resources.length === 0) {
      const error = new Error('No Jira sites are available to this account. Reconnect with read:jira-work access.');
      error.statusCode = 403;
      throw error;
    }

    const error = new Error('This Jira account can access multiple sites. Select a Jira cloud ID before syncing so Sneup does not ingest the wrong workspace.');
    error.statusCode = 409;
    throw error;
  }

  buildJql(cursorDate, config) {
    if (!cursorDate) return 'ORDER BY updated DESC';
    const since = new Date(cursorDate.getTime() - config.cursorLookbackMs);
    return `updated >= "${formatJqlDate(since)}" ORDER BY updated ASC`;
  }

  async fetchIssues(resource, token, cursorDate, config) {
    const issues = [];
    let nextPageToken;
    const jql = this.buildJql(cursorDate, config);

    do {
      const remaining = config.maxIssues - issues.length;
      const response = await this.http.post(
        `${config.apiUrl}/ex/jira/${encodeURIComponent(resource.id)}/rest/api/3/search/jql`,
        {
          jql,
          fields: [
            'summary', 'status', 'priority', 'assignee', 'reporter', 'labels', 'duedate',
            'created', 'updated', 'issuetype', 'project', 'parent', 'issuelinks'
          ],
          maxResults: Math.min(config.pageSize, remaining),
          ...(nextPageToken ? { nextPageToken } : {})
        },
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          timeout: config.timeout
        }
      );

      const page = Array.isArray(response.data?.issues) ? response.data.issues : [];
      issues.push(...page.map(issue => ({
        ...issue,
        url: resource.url && issue.key ? `${String(resource.url).replace(/\/$/, '')}/browse/${encodeURIComponent(issue.key)}` : issue.self,
        site: { id: resource.id, name: resource.name, url: resource.url }
      })));
      nextPageToken = response.data?.nextPageToken;

      if (issues.length >= config.maxIssues && nextPageToken) {
        const error = new Error('Jira sync reached its configured issue limit. Increase SNEUP_JIRA_MAX_ISSUES before continuing.');
        error.statusCode = 413;
        throw error;
      }
    } while (nextPageToken);

    return issues;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const cursorDate = parseCursor(cursor);
    const resources = await this.listAccessibleResources(token, config);
    const resource = this.selectResource(account, resources);
    const issues = await this.fetchIssues(resource, token, cursorDate, config);
    const since = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : null;
    let newest = cursorDate;

    const records = issues.filter(issue => {
      const updatedAt = parseCursor(issue.fields?.updated || issue.updated);
      if (updatedAt && (!newest || updatedAt > newest)) newest = updatedAt;
      return !since || !updatedAt || updatedAt >= since;
    });

    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'jira_api',
        sites: 1,
        cloudId: resource.id
      }
    };
  }
}

const jiraWorkSignalClient = new JiraWorkSignalClient();

module.exports = jiraWorkSignalClient;
module.exports.JiraWorkSignalClient = JiraWorkSignalClient;
