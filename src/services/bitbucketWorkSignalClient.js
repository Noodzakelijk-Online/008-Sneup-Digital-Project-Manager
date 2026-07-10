const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.bitbucket.org/2.0';
const APP_HOST = 'bitbucket.org';

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

const safePermalink = (value) => {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === APP_HOST ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const userName = (user) => user?.display_name || user?.nickname || user?.username || user?.uuid;

const sanitizeRepository = (repository) => ({
  id: repository.uuid || repository.full_name,
  fullName: repository.full_name,
  name: repository.name,
  slug: repository.slug,
  url: safePermalink(repository.links?.html?.href),
  updatedAt: repository.updated_on
});

const sanitizeIssue = (issue, repository) => ({
  id: `issue:${issue.id}`,
  sourceType: 'issue',
  title: issue.title,
  status: issue.state,
  priority: issue.priority,
  kind: issue.kind,
  owners: [userName(issue.assignee)].filter(Boolean),
  createdAt: issue.created_on,
  updatedAt: issue.updated_on,
  url: safePermalink(issue.links?.html?.href),
  repository
});

const sanitizePullRequest = (pullRequest, repository) => ({
  id: `pull_request:${pullRequest.id}`,
  sourceType: 'pull_request',
  title: pullRequest.title,
  status: pullRequest.state,
  owners: [userName(pullRequest.author), ...(pullRequest.reviewers || []).map(userName)].filter(Boolean),
  createdAt: pullRequest.created_on,
  updatedAt: pullRequest.updated_on,
  url: safePermalink(pullRequest.links?.html?.href),
  repository
});

class BitbucketWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clampInteger(process.env.SNEUP_BITBUCKET_TIMEOUT_MS, 15000, 1000, 60000),
      maxRepositories: clampInteger(process.env.SNEUP_BITBUCKET_MAX_REPOSITORIES, 20, 1, 100),
      maxItemsPerRepository: clampInteger(process.env.SNEUP_BITBUCKET_MAX_ITEMS_PER_REPOSITORY, 200, 1, 1000),
      maxTotalItems: clampInteger(process.env.SNEUP_BITBUCKET_MAX_TOTAL_ITEMS, 1000, 1, 5000),
      pageSize: clampInteger(process.env.SNEUP_BITBUCKET_PAGE_SIZE, 100, 1, 100),
      cursorLookbackMs: clampInteger(process.env.SNEUP_BITBUCKET_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.accessToken || credentials.apiKey;
    if (!token) {
      const error = new Error('Bitbucket API token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  getWorkspace(account) {
    const workspace = String(account?.metadata?.fields?.workspace || '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,61}$/i.test(workspace)) {
      const error = new Error('Bitbucket workspace slug is required. Reconnect this account with the workspace slug you want Sneup to read.');
      error.statusCode = 400;
      throw error;
    }
    return workspace;
  }

  request(path, token, config, params = {}) {
    return this.http.get(`${API_URL}${path}`, {
      params,
      timeout: config.timeout,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      }
    });
  }

  async listRepositories(workspace, token, config) {
    const repositories = [];
    let page = 1;
    let hasNext = true;
    while (hasNext) {
      const remaining = config.maxRepositories - repositories.length;
      if (remaining <= 0) {
        const error = new Error('Bitbucket sync reached its configured repository limit. Increase SNEUP_BITBUCKET_MAX_REPOSITORIES before continuing.');
        error.statusCode = 413;
        throw error;
      }
      const response = await this.request(`/repositories/${encodeURIComponent(workspace)}`, token, config, {
        page,
        pagelen: Math.min(config.pageSize, remaining),
        sort: '-updated_on'
      });
      const listed = Array.isArray(response.data?.values) ? response.data.values : [];
      repositories.push(...listed.map(sanitizeRepository));
      hasNext = Boolean(response.data?.next);
      if (hasNext && listed.length === 0) {
        const error = new Error('Bitbucket returned an incomplete repository page. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
      page += 1;
    }
    return repositories;
  }

  async listRepositoryItems(repository, workspace, token, config, state) {
    if (!repository.slug) return;
    for (const source of [
      { path: 'issues', extract: sanitizeIssue, params: { sort: '-updated_on' } },
      { path: 'pullrequests', extract: sanitizePullRequest, params: { state: 'OPEN', sort: '-updated_on' } }
    ]) {
      let page = 1;
      let hasNext = true;
      while (hasNext) {
        const remainingRepository = config.maxItemsPerRepository - state.repositoryItems;
        const remainingTotal = config.maxTotalItems - state.records.length;
        if (remainingRepository <= 0 || remainingTotal <= 0) {
          const error = new Error('Bitbucket sync reached its configured issue and pull-request limit. Increase SNEUP_BITBUCKET_MAX_ITEMS_PER_REPOSITORY or SNEUP_BITBUCKET_MAX_TOTAL_ITEMS before continuing.');
          error.statusCode = 413;
          throw error;
        }
        const response = await this.request(`/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repository.slug)}/${source.path}`, token, config, {
          page,
          pagelen: Math.min(config.pageSize, remainingRepository, remainingTotal),
          ...source.params
        });
        const items = Array.isArray(response.data?.values) ? response.data.values : [];
        for (const item of items) {
          const record = source.extract(item, repository);
          const updatedAt = parseDate(record.updatedAt || record.createdAt);
          if (updatedAt && (!state.newest || updatedAt > state.newest)) state.newest = updatedAt;
          if (!state.minimumUpdatedAt || !updatedAt || updatedAt >= state.minimumUpdatedAt) state.records.push(record);
        }
        state.repositoryItems += items.length;
        hasNext = Boolean(response.data?.next);
        if (hasNext && items.length === 0) {
          const error = new Error('Bitbucket returned an incomplete work-item page. Reconnect this account before syncing again.');
          error.statusCode = 502;
          throw error;
        }
        page += 1;
      }
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const workspace = this.getWorkspace(account);
    const cursorDate = parseDate(cursor);
    const state = {
      records: [],
      newest: cursorDate,
      minimumUpdatedAt: cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : null,
      repositoryItems: 0
    };
    const repositories = await this.listRepositories(workspace, token, config);
    for (const repository of repositories) {
      state.repositoryItems = 0;
      await this.listRepositoryItems(repository, workspace, token, config, state);
    }
    return {
      records: state.records,
      nextCursor: state.newest ? state.newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: { source: 'bitbucket_api', repositories: repositories.length, items: state.records.length }
    };
  }
}

const bitbucketWorkSignalClient = new BitbucketWorkSignalClient();

module.exports = bitbucketWorkSignalClient;
module.exports.BitbucketWorkSignalClient = BitbucketWorkSignalClient;
