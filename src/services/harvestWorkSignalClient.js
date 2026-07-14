const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.harvestapp.com/v2';
const USER_AGENT = 'Sneup Digital Project Manager (https://github.com/Noodzakelijk-Online/008-Sneup-Digital-Project-Manager)';

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

const dateOnly = (value) => value.toISOString().slice(0, 10);

const asFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const compactObject = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));

const sanitizeTimeEntry = (entry = {}) => compactObject({
  id: entry.id ? `time_entry:${entry.id}` : undefined,
  sourceType: 'time_entry',
  spentDate: entry.spent_date,
  hours: asFiniteNumber(entry.rounded_hours ?? entry.hours),
  approvalStatus: entry.approval_status,
  isRunning: entry.is_running === true,
  billable: entry.billable === true,
  createdAt: entry.created_at,
  updatedAt: entry.updated_at,
  user: compactObject({ id: entry.user?.id, name: entry.user?.name }),
  client: compactObject({ id: entry.client?.id, name: entry.client?.name }),
  project: compactObject({ id: entry.project?.id, name: entry.project?.name }),
  task: compactObject({ id: entry.task?.id, name: entry.task?.name })
});

class HarvestWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
    this.now = options.now || (() => new Date());
  }

  getConfig() {
    return {
      timeout: clampInteger(process.env.SNEUP_HARVEST_TIMEOUT_MS, 15000, 1000, 60000),
      maxEntries: clampInteger(process.env.SNEUP_HARVEST_MAX_ENTRIES, 2000, 1, 10000),
      pageSize: clampInteger(process.env.SNEUP_HARVEST_PAGE_SIZE, 250, 1, 2000),
      initialLookbackDays: clampInteger(process.env.SNEUP_HARVEST_INITIAL_LOOKBACK_DAYS, 90, 1, 365),
      cursorLookbackMs: clampInteger(process.env.SNEUP_HARVEST_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.accessToken || credentials.apiKey;
    if (!token) {
      const error = new Error('Harvest personal access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  getAccountId(account) {
    const accountId = String(account?.metadata?.fields?.accountId || '').trim();
    if (!/^[1-9][0-9]{0,18}$/.test(accountId)) {
      const error = new Error('Harvest account ID is required. Reconnect this account with the numeric account ID Sneup may read.');
      error.statusCode = 400;
      throw error;
    }
    return accountId;
  }

  request(accountId, token, config, params) {
    return this.http.get(`${API_URL}/time_entries`, {
      params,
      timeout: config.timeout,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Harvest-Account-Id': accountId,
        'User-Agent': USER_AGENT
      }
    });
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const accountId = this.getAccountId(account);
    const now = this.now();
    const cursorDate = parseDate(cursor);
    const initialStart = new Date(now);
    initialStart.setUTCDate(initialStart.getUTCDate() - config.initialLookbackDays);
    const updatedSince = cursorDate
      ? new Date(cursorDate.getTime() - config.cursorLookbackMs).toISOString()
      : null;
    const records = [];
    let newest = cursorDate;
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      const remaining = config.maxEntries - records.length;
      if (remaining <= 0) {
        const error = new Error('Harvest sync reached its configured time-entry limit. Increase SNEUP_HARVEST_MAX_ENTRIES before continuing.');
        error.statusCode = 413;
        throw error;
      }

      const response = await this.request(accountId, token, config, {
        page,
        per_page: Math.min(config.pageSize, remaining),
        from: dateOnly(initialStart),
        to: dateOnly(now),
        ...(updatedSince ? { updated_since: updatedSince } : {})
      });
      const entries = Array.isArray(response.data?.time_entries) ? response.data.time_entries : [];
      const totalEntries = Number(response.data?.total_entries);
      if (Number.isFinite(totalEntries) && totalEntries > config.maxEntries) {
        const error = new Error('Harvest sync reached its configured time-entry limit. Narrow the source window or increase SNEUP_HARVEST_MAX_ENTRIES before continuing.');
        error.statusCode = 413;
        throw error;
      }
      if (entries.length > remaining) {
        const error = new Error('Harvest returned more time entries than Sneup is configured to process. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }

      for (const entry of entries) {
        const record = sanitizeTimeEntry(entry);
        if (!record.id) continue;
        const updatedAt = parseDate(record.updatedAt || record.createdAt);
        if (updatedAt && (!newest || updatedAt > newest)) newest = updatedAt;
        records.push(record);
      }

      hasNextPage = Boolean(response.data?.next_page);
      if (hasNextPage && entries.length === 0) {
        const error = new Error('Harvest returned an incomplete time-entry page. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
      page += 1;
    }

    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: { source: 'harvest_api', projects: new Set(records.map(record => record.project?.id).filter(Boolean)).size, items: records.length }
    };
  }
}

const harvestWorkSignalClient = new HarvestWorkSignalClient();

module.exports = harvestWorkSignalClient;
module.exports.HarvestWorkSignalClient = HarvestWorkSignalClient;
