const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const DEFAULT_API_URL = 'https://api.github.com';
const DEFAULT_MAX_REPOSITORIES = 20;
const DEFAULT_MAX_ITEMS_PER_REPOSITORY = 200;
const DEFAULT_MAX_TOTAL_ITEMS = 1000;
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

const nextLinkPresent = (linkHeader) => /<[^>]+>;\s*rel="?next"?/i.test(String(linkHeader || ''));

class GitHubWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
    this.now = options.now || (() => new Date());
  }

  getConfig() {
    return {
      apiUrl: String(process.env.SNEUP_GITHUB_API_URL || DEFAULT_API_URL).replace(/\/$/, ''),
      timeout: clampInteger(process.env.SNEUP_GITHUB_TIMEOUT_MS, 15000, 1000, 60000),
      maxRepositories: clampInteger(process.env.SNEUP_GITHUB_MAX_REPOSITORIES, DEFAULT_MAX_REPOSITORIES, 1, 100),
      maxItemsPerRepository: clampInteger(process.env.SNEUP_GITHUB_MAX_ITEMS_PER_REPOSITORY, DEFAULT_MAX_ITEMS_PER_REPOSITORY, 1, 1000),
      maxTotalItems: clampInteger(process.env.SNEUP_GITHUB_MAX_TOTAL_ITEMS, DEFAULT_MAX_TOTAL_ITEMS, 1, 5000),
      cursorLookbackMs: clampInteger(process.env.SNEUP_GITHUB_CURSOR_LOOKBACK_MS, DEFAULT_CURSOR_LOOKBACK_MS, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('GitHub access token is missing. Reconnect this account to continue syncing.');
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
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Sneup-Digital-Project-Manager',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
  }

  async listRepositories(token, config) {
    const response = await this.request('/user/repos', token, config, {
      affiliation: 'owner,collaborator,organization_member',
      direction: 'desc',
      per_page: config.maxRepositories,
      sort: 'updated',
      visibility: 'all'
    });
    return Array.isArray(response.data) ? response.data : [];
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const cursorDate = parseCursor(cursor);
    const since = cursorDate
      ? new Date(cursorDate.getTime() - config.cursorLookbackMs).toISOString()
      : undefined;
    const repositories = await this.listRepositories(token, config);
    const records = [];
    let newest = cursorDate;

    for (const repository of repositories) {
      if (!repository?.full_name || repository.archived || repository.disabled) continue;
      const [owner, name] = String(repository.full_name).split('/');
      if (!owner || !name) continue;

      let page = 1;
      let repositoryItems = 0;
      let hasNextPage = true;
      while (hasNextPage) {
        const remainingRepository = config.maxItemsPerRepository - repositoryItems;
        const remainingTotal = config.maxTotalItems - records.length;
        if (remainingRepository <= 0 || remainingTotal <= 0) {
          const error = new Error('GitHub sync reached its bounded batch limit. Increase the GitHub sync limits before continuing.');
          error.statusCode = 413;
          throw error;
        }

        const response = await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`, token, config, {
          direction: 'desc',
          page,
          per_page: Math.min(100, remainingRepository, remainingTotal),
          since,
          sort: 'updated',
          state: 'all'
        });
        const items = Array.isArray(response.data) ? response.data : [];
        for (const item of items) {
          const updatedAt = parseCursor(item.updated_at || item.closed_at || item.created_at);
          if (updatedAt && (!newest || updatedAt > newest)) newest = updatedAt;
          records.push({
            ...item,
            repository: {
              id: repository.id,
              node_id: repository.node_id,
              full_name: repository.full_name,
              html_url: repository.html_url,
              owner: { login: repository.owner?.login }
            }
          });
        }
        repositoryItems += items.length;
        hasNextPage = nextLinkPresent(response.headers?.link);
        if (hasNextPage && items.length === 0) break;
        page += 1;
      }
    }

    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'github_api',
        repositories: repositories.length
      }
    };
  }
}

const githubWorkSignalClient = new GitHubWorkSignalClient();

module.exports = githubWorkSignalClient;
module.exports.GitHubWorkSignalClient = GitHubWorkSignalClient;
