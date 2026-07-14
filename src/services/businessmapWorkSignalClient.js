const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const error = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const boundedText = value => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 240) : undefined;
};
const parseDate = value => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const normalizeAccountUrl = value => {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const allowedHost = /^[a-z0-9][a-z0-9-]{0,62}\.kanbanize\.com$/.test(hostname);
  const allowedPath = ['', '/', '/api/v2', '/api/v2/'].includes(url.pathname);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !allowedHost || !allowedPath) return null;
  return `${url.origin}/api/v2`;
};

const board = value => {
  const boardId = String(value?.board_id || value?.id || '');
  const name = boundedText(value?.name);
  if (!validId(boardId) || !name) return null;
  return {
    id: `board:${boardId}`,
    sourceType: 'board',
    boardId,
    name,
    status: 'active'
  };
};

const card = (value, boards) => {
  const cardId = String(value?.card_id || value?.id || '');
  const boardId = String(value?.board_id || value?.boardId || '');
  const name = boundedText(value?.title || value?.name);
  const createdAt = parseDate(value?.created_at || value?.createdAt);
  const updatedAt = parseDate(value?.last_modified || value?.updated_at || value?.updatedAt);
  const dueAt = parseDate(value?.deadline || value?.dueAt);
  if (!validId(cardId) || !validId(boardId) || !name) return null;
  return compact({
    id: `card:${cardId}`,
    sourceType: 'card',
    cardId,
    boardId,
    board: boards.get(boardId),
    name,
    status: Number(value?.is_blocked) === 1 ? 'blocked' : 'active',
    priority: value?.priority === undefined || value?.priority === null ? undefined : String(value.priority),
    customId: boundedText(value?.custom_id),
    workflowId: validId(value?.workflow_id || value?.workflowId) ? String(value.workflow_id || value.workflowId) : undefined,
    columnId: validId(value?.column_id || value?.columnId) ? String(value.column_id || value.columnId) : undefined,
    laneId: validId(value?.lane_id || value?.laneId) ? String(value.lane_id || value.laneId) : undefined,
    dueAt: dueAt?.toISOString(),
    createdAt: createdAt?.toISOString(),
    updatedAt: updatedAt?.toISOString()
  });
};

class BusinessmapWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig(account) {
    const apiUrl = normalizeAccountUrl(account?.metadata?.fields?.apiUrl || account?.metadata?.fields?.accountUrl);
    if (!apiUrl) throw error('Businessmap account URL must be one public HTTPS *.kanbanize.com account URL. Reconnect this account to continue.', 400);
    return {
      apiUrl,
      timeout: clamp(process.env.SNEUP_BUSINESSMAP_TIMEOUT_MS, 15000, 1000, 60000),
      maxBoards: clamp(process.env.SNEUP_BUSINESSMAP_MAX_BOARDS, 100, 1, 500),
      maxCards: clamp(process.env.SNEUP_BUSINESSMAP_MAX_CARDS, 2500, 1, 10000),
      cursorLookbackMs: clamp(process.env.SNEUP_BUSINESSMAP_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getApiKey(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const apiKey = credentials.apiKey || credentials.apiToken || credentials.token || credentials.accessToken;
    if (!apiKey) throw error('Businessmap API key is missing. Reconnect this account to continue syncing.', 503);
    return apiKey;
  }

  request(config, apiKey, path, params) {
    return this.http.get(`${config.apiUrl}${path}`, {
      params,
      headers: {
        Accept: 'application/json',
        apikey: apiKey,
        'User-Agent': 'Sneup Digital Project Manager'
      },
      timeout: config.timeout,
      maxRedirects: 0,
      proxy: false
    });
  }

  async listBoards(config, apiKey) {
    const response = await this.request(config, apiKey, '/boards');
    const values = Array.isArray(response?.data?.data) ? response.data.data : null;
    if (!values) throw error('Businessmap returned an invalid board collection. Reconnect this account before syncing again.');
    if (values.length >= config.maxBoards) throw error('Businessmap sync reached its configured board limit. Increase SNEUP_BUSINESSMAP_MAX_BOARDS before continuing.', 413);
    const records = values
      .filter(item => Number(item?.is_archived) !== 1)
      .map(board);
    if (records.some(item => !item)) throw error('Businessmap returned invalid board metadata. Reconnect this account before syncing again.');
    return records;
  }

  async listCards(config, apiKey, boards) {
    const records = [];
    for (const boardRecord of boards) {
      let page = 1;
      let allPages;
      while (true) {
        const remaining = config.maxCards - records.length;
        if (remaining <= 0) throw error('Businessmap sync reached its configured card limit. Increase SNEUP_BUSINESSMAP_MAX_CARDS before continuing.', 413);
        const response = await this.request(config, apiKey, '/cards', {
          board_ids: boardRecord.boardId,
          page,
          state: 'active'
        });
        const payload = response?.data?.data;
        const values = payload?.data;
        const pagination = payload?.pagination;
        const pageCount = Number(pagination?.all_pages);
        const currentPage = Number(pagination?.current_page);
        if (!Array.isArray(values) || !Number.isInteger(pageCount) || pageCount < 1 || !Number.isInteger(currentPage) || currentPage !== page || values.length > 200 || values.length > remaining) {
          throw error('Businessmap returned an ambiguous card page. Reconnect this account before syncing again.');
        }
        if (allPages === undefined) allPages = pageCount;
        if (pageCount !== allPages || page > pageCount || (page < pageCount && values.length === 0)) {
          throw error('Businessmap returned an incomplete card page. Reconnect this account before syncing again.');
        }
        records.push(...values);
        if (page === pageCount) break;
        page += 1;
      }
    }
    return records;
  }

  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : undefined;
    if (cursor && !cursorDate) throw error('Businessmap work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const config = this.getConfig(account);
    const apiKey = this.getApiKey(account);
    const boards = await this.listBoards(config, apiKey);
    const boardMap = new Map(boards.map(item => [item.boardId, { id: item.boardId, name: item.name }]));
    const rawCards = await this.listCards(config, apiKey, boards);
    const cards = rawCards.map(item => card(item, boardMap));
    if (cards.some(item => !item)) throw error('Businessmap returned invalid card metadata. Reconnect this account before syncing again.');
    const cutoff = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : undefined;
    const records = [...boards, ...cards].filter(item => {
      const updated = parseDate(item.updatedAt || item.createdAt);
      return !cutoff || !updated || updated >= cutoff;
    });
    const newest = records.reduce((latest, item) => {
      const updated = parseDate(item.updatedAt || item.createdAt);
      return updated && (!latest || updated > latest) ? updated : latest;
    }, cursorDate);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'businessmap_api_v2',
        boards: boards.length,
        cards: cards.length,
        contentPolicy: 'active_board_and_card_metadata_only_no_descriptions_comments_custom_fields_files_dependencies_users_time_data_or_provider_writes'
      }
    };
  }
}

const businessmapWorkSignalClient = new BusinessmapWorkSignalClient();
module.exports = businessmapWorkSignalClient;
module.exports.BusinessmapWorkSignalClient = BusinessmapWorkSignalClient;
