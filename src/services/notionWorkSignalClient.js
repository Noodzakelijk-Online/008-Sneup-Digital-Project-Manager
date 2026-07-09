const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const DEFAULT_API_URL = 'https://api.notion.com/v1';
const DEFAULT_VERSION = '2026-03-11';

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

class NotionWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      apiUrl: String(process.env.SNEUP_NOTION_API_URL || DEFAULT_API_URL).replace(/\/$/, ''),
      version: String(process.env.SNEUP_NOTION_VERSION || DEFAULT_VERSION).trim() || DEFAULT_VERSION,
      timeout: clampInteger(process.env.SNEUP_NOTION_TIMEOUT_MS, 15000, 1000, 60000),
      maxResults: clampInteger(process.env.SNEUP_NOTION_MAX_RESULTS, 500, 1, 2000),
      pageSize: clampInteger(process.env.SNEUP_NOTION_PAGE_SIZE, 100, 1, 100),
      cursorLookbackMs: clampInteger(process.env.SNEUP_NOTION_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('Notion access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  request(cursor, pageSize, token, config) {
    return this.http.post(`${config.apiUrl}/search`, {
      page_size: pageSize,
      ...(cursor ? { start_cursor: cursor } : {}),
      sort: { direction: 'descending', timestamp: 'last_edited_time' }
    }, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': config.version
      },
      timeout: config.timeout
    });
  }

  shouldInclude(record, cursorDate, config) {
    if (!cursorDate) return true;
    const updatedAt = parseDate(record.last_edited_time || record.created_time);
    return !updatedAt || updatedAt >= new Date(cursorDate.getTime() - config.cursorLookbackMs);
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const cursorDate = parseDate(cursor);
    const records = [];
    let nextPageCursor = null;
    let fetchedCount = 0;
    let newest = cursorDate;
    let hasMore = true;

    while (hasMore) {
      const remaining = config.maxResults - fetchedCount;
      if (remaining <= 0) {
        const error = new Error('Notion sync reached its configured result limit. Increase SNEUP_NOTION_MAX_RESULTS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      const response = await this.request(nextPageCursor, Math.min(config.pageSize, remaining), token, config);
      const page = Array.isArray(response.data?.results) ? response.data.results : [];
      fetchedCount += page.length;
      for (const record of page) {
        if (!this.shouldInclude(record, cursorDate, config)) continue;
        const updatedAt = parseDate(record.last_edited_time || record.created_time);
        if (updatedAt && (!newest || updatedAt > newest)) newest = updatedAt;
        records.push(record);
      }
      hasMore = Boolean(response.data?.has_more);
      nextPageCursor = response.data?.next_cursor || null;
      if (hasMore && (!nextPageCursor || page.length === 0)) {
        const error = new Error('Notion returned an incomplete pagination cursor. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
      if (hasMore && fetchedCount >= config.maxResults) {
        const error = new Error('Notion sync reached its configured result limit. Increase SNEUP_NOTION_MAX_RESULTS before continuing.');
        error.statusCode = 413;
        throw error;
      }
    }

    const pages = records.filter(record => record.object === 'page').length;
    const dataSources = records.filter(record => record.object === 'data_source').length;
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: { source: 'notion_api', pages, dataSources }
    };
  }
}

const notionWorkSignalClient = new NotionWorkSignalClient();

module.exports = notionWorkSignalClient;
module.exports.NotionWorkSignalClient = NotionWorkSignalClient;
