const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const DEFAULT_API_URL = 'https://gitlab.com/api/v4';
const DEFAULT_MAX_ITEMS = 1000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_CURSOR_LOOKBACK_MS = 60000;

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

const user = (value) => value && ({
  id: value.id,
  username: value.username,
  name: value.name
});

const sanitizeMilestone = (value) => value && ({
  id: value.id,
  title: value.title,
  dueDate: value.due_date,
  state: value.state
});

const sanitizeItem = (item, source) => ({
  id: `${source}:${item.id}`,
  gitlabSource: source,
  sourceType: source === 'merge_request' ? 'pull_request' : 'issue',
  title: item.title,
  state: item.state,
  labels: Array.isArray(item.labels) ? item.labels.filter(label => typeof label === 'string') : [],
  author: user(item.author),
  assignees: (Array.isArray(item.assignees) ? item.assignees : []).map(user).filter(Boolean),
  reviewers: (Array.isArray(item.reviewers) ? item.reviewers : []).map(user).filter(Boolean),
  projectId: item.project_id,
  references: item.references ? {
    full: item.references.full,
    relative: item.references.relative
  } : undefined,
  milestone: sanitizeMilestone(item.milestone),
  dueDate: item.due_date,
  createdAt: item.created_at,
  updatedAt: item.updated_at,
  closedAt: item.closed_at,
  mergedAt: item.merged_at,
  draft: Boolean(item.draft),
  webUrl: item.web_url
});

class GitLabWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      apiUrl: String(process.env.SNEUP_GITLAB_API_URL || DEFAULT_API_URL).replace(/\/$/, ''),
      timeout: clampInteger(process.env.SNEUP_GITLAB_TIMEOUT_MS, 15000, 1000, 60000),
      maxItems: clampInteger(process.env.SNEUP_GITLAB_MAX_ITEMS, DEFAULT_MAX_ITEMS, 1, 5000),
      pageSize: clampInteger(process.env.SNEUP_GITLAB_PAGE_SIZE, DEFAULT_PAGE_SIZE, 1, 100),
      cursorLookbackMs: clampInteger(process.env.SNEUP_GITLAB_CURSOR_LOOKBACK_MS, DEFAULT_CURSOR_LOOKBACK_MS, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('GitLab access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  request(path, token, config, params = {}) {
    return this.http.get(`${config.apiUrl}${path}`, {
      params,
      timeout: config.timeout,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      }
    });
  }

  async listItems(path, source, token, config, minimumUpdatedAt, state) {
    let page = 1;
    let hasNextPage = true;
    while (hasNextPage) {
      const remaining = config.maxItems - state.records.length;
      if (remaining <= 0) {
        const error = new Error('GitLab sync reached its configured item limit. Increase SNEUP_GITLAB_MAX_ITEMS before continuing.');
        error.statusCode = 413;
        throw error;
      }

      const response = await this.request(path, token, config, {
        order_by: 'updated_at',
        page,
        per_page: Math.min(config.pageSize, remaining),
        scope: 'all',
        sort: 'desc',
        state: 'all',
        updated_after: minimumUpdatedAt?.toISOString()
      });
      const items = Array.isArray(response.data) ? response.data : [];
      for (const item of items) {
        const record = sanitizeItem(item, source);
        const updatedAt = parseDate(record.updatedAt || record.closedAt || record.createdAt);
        if (updatedAt && (!state.newest || updatedAt > state.newest)) state.newest = updatedAt;
        if (!minimumUpdatedAt || !updatedAt || updatedAt >= minimumUpdatedAt) {
          state.records.push(record);
          state.counts[source] += 1;
        }
      }

      const nextPage = String(response.headers?.['x-next-page'] || '').trim();
      hasNextPage = Boolean(nextPage);
      if (hasNextPage && items.length === 0) {
        const error = new Error('GitLab returned an incomplete work-item page. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
      page = Number.parseInt(nextPage, 10) || page + 1;
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const cursorDate = parseDate(cursor);
    const minimumUpdatedAt = cursorDate
      ? new Date(cursorDate.getTime() - config.cursorLookbackMs)
      : null;
    const state = {
      records: [],
      newest: cursorDate,
      counts: { issue: 0, merge_request: 0 }
    };

    await this.listItems('/issues', 'issue', token, config, minimumUpdatedAt, state);
    await this.listItems('/merge_requests', 'merge_request', token, config, minimumUpdatedAt, state);

    return {
      records: state.records,
      nextCursor: state.newest ? state.newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'gitlab_api',
        issues: state.counts.issue,
        mergeRequests: state.counts.merge_request,
        items: state.records.length
      }
    };
  }
}

const gitlabWorkSignalClient = new GitLabWorkSignalClient();

module.exports = gitlabWorkSignalClient;
module.exports.GitLabWorkSignalClient = GitLabWorkSignalClient;
