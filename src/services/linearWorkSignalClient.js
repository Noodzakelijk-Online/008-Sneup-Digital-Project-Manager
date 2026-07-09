const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const DEFAULT_GRAPHQL_URL = 'https://api.linear.app/graphql';

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

const ISSUE_QUERY = `
  query SneupWorkSignals($first: Int!, $after: String) {
    issues(first: $first, after: $after, orderBy: updatedAt) {
      nodes {
        id
        identifier
        title
        description
        priority
        dueDate
        createdAt
        updatedAt
        completedAt
        canceledAt
        url
        state { name type }
        assignee { id name email }
        team { id name key }
        project { id name }
        cycle { id name number }
        labels { nodes { id name } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

class LinearWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      graphqlUrl: String(process.env.SNEUP_LINEAR_GRAPHQL_URL || DEFAULT_GRAPHQL_URL).replace(/\/$/, ''),
      timeout: clampInteger(process.env.SNEUP_LINEAR_TIMEOUT_MS, 15000, 1000, 60000),
      maxIssues: clampInteger(process.env.SNEUP_LINEAR_MAX_ISSUES, 1000, 1, 5000),
      pageSize: clampInteger(process.env.SNEUP_LINEAR_PAGE_SIZE, 100, 1, 250),
      cursorLookbackMs: clampInteger(process.env.SNEUP_LINEAR_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('Linear access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  async requestIssues(token, config, first, after) {
    const response = await this.http.post(config.graphqlUrl, {
      query: ISSUE_QUERY,
      variables: { first, after: after || null }
    }, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: config.timeout
    });
    const errors = Array.isArray(response.data?.errors) ? response.data.errors : [];
    if (errors.length > 0) {
      const rateLimited = errors.some(error => error?.extensions?.code === 'RATELIMITED');
      const error = new Error(errors.map(item => item?.message).filter(Boolean).join('; ') || 'Linear GraphQL request failed.');
      error.statusCode = rateLimited ? 429 : 502;
      throw error;
    }
    return response.data?.data?.issues || { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
  }

  shouldInclude(issue, cursorDate, config) {
    if (!cursorDate) return true;
    const updatedAt = parseCursor(issue.updatedAt || issue.createdAt);
    return !updatedAt || updatedAt >= new Date(cursorDate.getTime() - config.cursorLookbackMs);
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const cursorDate = parseCursor(cursor);
    const records = [];
    let nextPageCursor = null;
    let newest = cursorDate;
    let hasNextPage = true;
    let fetchedIssues = 0;

    while (hasNextPage) {
      const remaining = config.maxIssues - fetchedIssues;
      if (remaining <= 0) {
        const error = new Error('Linear sync reached its configured issue limit. Increase SNEUP_LINEAR_MAX_ISSUES before continuing.');
        error.statusCode = 413;
        throw error;
      }
      const page = await this.requestIssues(token, config, Math.min(config.pageSize, remaining), nextPageCursor);
      const nodes = Array.isArray(page.nodes) ? page.nodes : [];
      fetchedIssues += nodes.length;
      for (const issue of nodes) {
        if (!this.shouldInclude(issue, cursorDate, config)) continue;
        const updatedAt = parseCursor(issue.updatedAt || issue.createdAt);
        if (updatedAt && (!newest || updatedAt > newest)) newest = updatedAt;
        records.push(issue);
      }
      hasNextPage = Boolean(page.pageInfo?.hasNextPage);
      nextPageCursor = page.pageInfo?.endCursor || null;
      if (hasNextPage && (!nextPageCursor || nodes.length === 0)) {
        const error = new Error('Linear returned an incomplete pagination cursor. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
      if (hasNextPage && fetchedIssues >= config.maxIssues) {
        const error = new Error('Linear sync reached its configured issue limit. Increase SNEUP_LINEAR_MAX_ISSUES before continuing.');
        error.statusCode = 413;
        throw error;
      }
    }

    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: { source: 'linear_graphql', issues: records.length }
    };
  }
}

const linearWorkSignalClient = new LinearWorkSignalClient();

module.exports = linearWorkSignalClient;
module.exports.LinearWorkSignalClient = LinearWorkSignalClient;
