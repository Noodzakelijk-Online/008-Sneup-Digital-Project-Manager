const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const DEFAULT_API_URL = 'https://api.monday.com/v2';
const DEFAULT_API_VERSION = '2025-10';

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

const BOARD_QUERY = `
  query SneupMondayBoards($limit: Int!) {
    boards(limit: $limit, state: active) {
      id
      name
      url
      state
      updated_at
    }
  }
`;

const BOARD_ITEMS_QUERY = `
  query SneupMondayBoardItems($boardId: ID!, $limit: Int!) {
    boards(ids: [$boardId]) {
      id
      name
      url
      state
      updated_at
      items_page(limit: $limit) {
        cursor
        items {
          id
          name
          url
          created_at
          updated_at
          group { id title }
          column_values { id type text }
        }
      }
    }
  }
`;

const NEXT_ITEMS_QUERY = `
  query SneupMondayNextItems($cursor: String!, $limit: Int!) {
    next_items_page(cursor: $cursor, limit: $limit) {
      cursor
      items {
        id
        name
        url
        created_at
        updated_at
        group { id title }
        column_values { id type text }
      }
    }
  }
`;

class MondayWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      apiUrl: String(process.env.SNEUP_MONDAY_API_URL || DEFAULT_API_URL).replace(/\/$/, ''),
      apiVersion: String(process.env.SNEUP_MONDAY_API_VERSION || DEFAULT_API_VERSION).trim() || DEFAULT_API_VERSION,
      timeout: clampInteger(process.env.SNEUP_MONDAY_TIMEOUT_MS, 15000, 1000, 60000),
      maxBoards: clampInteger(process.env.SNEUP_MONDAY_MAX_BOARDS, 25, 1, 100),
      maxItemsPerBoard: clampInteger(process.env.SNEUP_MONDAY_MAX_ITEMS_PER_BOARD, 250, 1, 500),
      maxTotalItems: clampInteger(process.env.SNEUP_MONDAY_MAX_TOTAL_ITEMS, 2500, 1, 10000),
      cursorLookbackMs: clampInteger(process.env.SNEUP_MONDAY_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('monday.com access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  async request(query, variables, token, config) {
    const response = await this.http.post(config.apiUrl, { query, variables }, {
      headers: {
        Accept: 'application/json',
        Authorization: token,
        'Content-Type': 'application/json',
        'API-Version': config.apiVersion
      },
      timeout: config.timeout
    });
    const errors = Array.isArray(response.data?.errors) ? response.data.errors : [];
    if (errors.length > 0) {
      const rateLimited = errors.some(error => /rate.?limit|complexity/i.test(`${error?.message || ''} ${error?.extensions?.code || ''}`));
      const error = new Error(errors.map(item => item?.message).filter(Boolean).join('; ') || 'monday.com GraphQL request failed.');
      error.statusCode = rateLimited ? 429 : 502;
      throw error;
    }
    return response.data?.data || {};
  }

  shouldInclude(item, cursorDate, config) {
    if (!cursorDate) return true;
    const updatedAt = parseDate(item.updated_at || item.created_at);
    return !updatedAt || updatedAt >= new Date(cursorDate.getTime() - config.cursorLookbackMs);
  }

  async fetchItemsForBoard(board, token, config, cursorDate, state) {
    let result = await this.request(BOARD_ITEMS_QUERY, {
      boardId: String(board.id),
      limit: Math.min(config.maxItemsPerBoard, config.maxTotalItems - state.fetchedTotal)
    }, token, config);
    const boardResult = Array.isArray(result.boards) ? result.boards[0] : null;
    if (!boardResult) return;
    const resolvedBoard = {
      id: boardResult.id || board.id,
      name: boardResult.name || board.name,
      url: boardResult.url || board.url,
      state: boardResult.state || board.state,
      updated_at: boardResult.updated_at || board.updated_at
    };
    let page = boardResult.items_page || { items: [], cursor: null };
    let boardFetched = 0;
    let seenCursors = new Set();

    while (true) {
      const items = Array.isArray(page.items) ? page.items : [];
      state.fetchedTotal += items.length;
      boardFetched += items.length;
      for (const item of items) {
        if (!this.shouldInclude(item, cursorDate, config)) continue;
        const updatedAt = parseDate(item.updated_at || item.created_at);
        if (updatedAt && (!state.newest || updatedAt > state.newest)) state.newest = updatedAt;
        state.records.push({ ...item, board: resolvedBoard });
      }

      const nextCursor = page.cursor || null;
      if (!nextCursor) return;
      if (items.length === 0 || seenCursors.has(nextCursor)) {
        const error = new Error('monday.com returned an incomplete item pagination cursor. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
      if (boardFetched >= config.maxItemsPerBoard || state.fetchedTotal >= config.maxTotalItems) {
        const error = new Error('monday.com sync reached its configured item limit. Increase SNEUP_MONDAY_MAX_ITEMS_PER_BOARD or SNEUP_MONDAY_MAX_TOTAL_ITEMS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      seenCursors.add(nextCursor);
      const remainingForBoard = config.maxItemsPerBoard - boardFetched;
      const remainingTotal = config.maxTotalItems - state.fetchedTotal;
      result = await this.request(NEXT_ITEMS_QUERY, {
        cursor: nextCursor,
        limit: Math.min(remainingForBoard, remainingTotal)
      }, token, config);
      page = result.next_items_page || { items: [], cursor: null };
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const cursorDate = parseDate(cursor);
    const boardResult = await this.request(BOARD_QUERY, { limit: config.maxBoards }, token, config);
    const boards = Array.isArray(boardResult.boards) ? boardResult.boards : [];
    if (boards.length >= config.maxBoards) {
      const error = new Error('monday.com sync reached its configured board limit. Increase SNEUP_MONDAY_MAX_BOARDS before continuing.');
      error.statusCode = 413;
      throw error;
    }
    const state = { records: [], fetchedTotal: 0, newest: cursorDate };
    for (const board of boards) {
      if (state.fetchedTotal >= config.maxTotalItems) {
        const error = new Error('monday.com sync reached its configured item limit. Increase SNEUP_MONDAY_MAX_TOTAL_ITEMS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      await this.fetchItemsForBoard(board, token, config, cursorDate, state);
    }
    return {
      records: state.records,
      nextCursor: state.newest ? state.newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: { source: 'monday_api', boards: boards.length, items: state.records.length }
    };
  }
}

const mondayWorkSignalClient = new MondayWorkSignalClient();

module.exports = mondayWorkSignalClient;
module.exports.MondayWorkSignalClient = MondayWorkSignalClient;
