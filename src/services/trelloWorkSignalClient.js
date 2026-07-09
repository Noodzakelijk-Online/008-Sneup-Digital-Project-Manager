const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const DEFAULT_API_URL = 'https://api.trello.com/1';
const DEFAULT_MAX_BOARDS = 25;
const DEFAULT_MAX_CARDS_PER_BOARD = 250;
const DEFAULT_MAX_TOTAL_CARDS = 2500;
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

class TrelloWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      apiUrl: String(process.env.SNEUP_TRELLO_API_URL || DEFAULT_API_URL).replace(/\/$/, ''),
      timeout: clampInteger(process.env.SNEUP_TRELLO_TIMEOUT_MS, 15000, 1000, 60000),
      maxBoards: clampInteger(process.env.SNEUP_TRELLO_MAX_BOARDS, DEFAULT_MAX_BOARDS, 1, 100),
      maxCardsPerBoard: clampInteger(process.env.SNEUP_TRELLO_MAX_CARDS_PER_BOARD, DEFAULT_MAX_CARDS_PER_BOARD, 1, 1000),
      maxTotalCards: clampInteger(process.env.SNEUP_TRELLO_MAX_TOTAL_CARDS, DEFAULT_MAX_TOTAL_CARDS, 1, 10000),
      cursorLookbackMs: clampInteger(process.env.SNEUP_TRELLO_CURSOR_LOOKBACK_MS, DEFAULT_CURSOR_LOOKBACK_MS, 0, 3600000)
    };
  }

  getCredentials(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const apiKey = credentials.apiKey || credentials.key;
    const apiToken = credentials.apiToken || credentials.token;
    if (!apiKey || !apiToken) {
      const error = new Error('Trello API key or token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return { apiKey, apiToken };
  }

  request(path, credentials, config, params = {}) {
    return this.http.get(`${config.apiUrl}${path}`, {
      params: {
        ...params,
        key: credentials.apiKey,
        token: credentials.apiToken
      },
      timeout: config.timeout
    });
  }

  async listBoards(credentials, config) {
    const response = await this.request('/members/me/boards', credentials, config, {
      fields: 'id,name,url,closed,dateLastActivity',
      filter: 'open',
      limit: config.maxBoards
    });
    const boards = Array.isArray(response.data) ? response.data : [];
    if (boards.length >= config.maxBoards) {
      const error = new Error('Trello sync reached its configured board limit. Increase SNEUP_TRELLO_MAX_BOARDS before continuing.');
      error.statusCode = 413;
      throw error;
    }
    return boards;
  }

  async listBoardCards(board, credentials, config) {
    const response = await this.request(`/boards/${encodeURIComponent(board.id)}/cards`, credentials, config, {
      fields: 'id,name,desc,url,closed,due,dueComplete,dateLastActivity,idList,idMembers,labels',
      filter: 'all',
      limit: config.maxCardsPerBoard,
      members: 'true',
      member_fields: 'id,username,fullName'
    });
    const cards = Array.isArray(response.data) ? response.data : [];
    if (cards.length >= config.maxCardsPerBoard) {
      const error = new Error(`Trello board ${board.name || board.id} reached its configured card limit. Increase SNEUP_TRELLO_MAX_CARDS_PER_BOARD before continuing.`);
      error.statusCode = 413;
      throw error;
    }
    return cards;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const credentials = this.getCredentials(account);
    const cursorDate = parseCursor(cursor);
    const since = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : null;
    const boards = await this.listBoards(credentials, config);
    const records = [];
    let newest = cursorDate;

    for (const board of boards) {
      const cards = await this.listBoardCards(board, credentials, config);
      if (records.length + cards.length > config.maxTotalCards) {
        const error = new Error('Trello sync reached its configured total-card limit. Increase SNEUP_TRELLO_MAX_TOTAL_CARDS before continuing.');
        error.statusCode = 413;
        throw error;
      }

      for (const card of cards) {
        const activityAt = parseCursor(card.dateLastActivity);
        if (activityAt && (!newest || activityAt > newest)) newest = activityAt;
        if (since && activityAt && activityAt < since) continue;
        records.push({
          ...card,
          board: {
            id: board.id,
            name: board.name,
            url: board.url
          }
        });
      }
    }

    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'trello_api',
        boards: boards.length
      }
    };
  }
}

const trelloWorkSignalClient = new TrelloWorkSignalClient();

module.exports = trelloWorkSignalClient;
module.exports.TrelloWorkSignalClient = TrelloWorkSignalClient;
