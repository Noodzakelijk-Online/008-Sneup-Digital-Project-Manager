const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.everhour.com';
const USER_AGENT = 'Sneup Digital Project Manager (https://github.com/Noodzakelijk-Online/008-Sneup-Digital-Project-Manager)';

const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

const compact = value => Object.fromEntries(
  Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== '')
);

const parseDate = value => {
  const parsed = new Date(value);
  return value && !Number.isNaN(parsed.getTime()) ? parsed : null;
};

const dateOnly = value => value.toISOString().slice(0, 10);
const safeId = value => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ''));

const boundedText = (value, maximum = 160) => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, maximum) : undefined;
};

const hoursFor = entry => {
  const explicitHours = Number(entry?.hours);
  if (Number.isFinite(explicitHours) && explicitHours >= 0 && explicitHours <= 10000) return explicitHours;
  const seconds = Number(entry?.time ?? entry?.seconds ?? entry?.duration);
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 36000000 ? seconds / 3600 : undefined;
};

const timeEntry = (entry = {}) => {
  const timeEntryId = String(entry.id || '');
  const projectId = entry.project?.id ?? entry.projectId ?? entry.project_id;
  const taskId = entry.task?.id ?? entry.taskId ?? entry.task_id;
  const userId = entry.user?.id ?? entry.userId ?? entry.user_id;
  if (!safeId(timeEntryId)) return null;
  return compact({
    id: `time_entry:${timeEntryId}`,
    sourceType: 'time_entry',
    timeEntryId,
    spentDate: entry.date ?? entry.spentDate,
    hours: hoursFor(entry),
    billable: entry.billable === true,
    createdAt: entry.createdAt ?? entry.created_at,
    updatedAt: entry.updatedAt ?? entry.updated_at,
    user: compact({
      id: safeId(userId) ? String(userId) : undefined,
      name: boundedText(entry.user?.name ?? entry.userName, 120)
    }),
    project: compact({
      id: safeId(projectId) ? String(projectId) : undefined,
      name: boundedText(entry.project?.name ?? entry.projectName, 160)
    }),
    task: compact({
      id: safeId(taskId) ? String(taskId) : undefined,
      name: boundedText(entry.task?.name ?? entry.taskName, 160)
    })
  });
};

class EverhourWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
    this.now = options.now || (() => new Date());
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_EVERHOUR_TIMEOUT_MS, 15000, 1000, 60000),
      maxEntries: clamp(process.env.SNEUP_EVERHOUR_MAX_ENTRIES, 2000, 1, 10000),
      initialLookbackDays: clamp(process.env.SNEUP_EVERHOUR_INITIAL_LOOKBACK_DAYS, 30, 1, 90),
      maxResponseBytes: clamp(process.env.SNEUP_EVERHOUR_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000)
    };
  }

  getApiKey(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const apiKey = credentials.apiKey || credentials.token || credentials.accessToken;
    if (!apiKey) {
      const error = new Error('Everhour API key is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return apiKey;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const apiKey = this.getApiKey(account);
    const now = this.now();
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - config.initialLookbackDays);
    const response = await this.http.get(`${API_URL}/time`, {
      params: { from: dateOnly(start), to: dateOnly(now), limit: config.maxEntries + 1 },
      headers: { Accept: 'application/json', 'X-API-Key': apiKey, 'User-Agent': USER_AGENT },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
    const sourceEntries = Array.isArray(response.data) ? response.data : response.data?.time;
    if (!Array.isArray(sourceEntries)) {
      const error = new Error('Everhour returned an invalid time-entry collection. Reconnect this account before syncing again.');
      error.statusCode = 502;
      throw error;
    }
    if (sourceEntries.length >= config.maxEntries) {
      const error = new Error('Everhour sync reached its configured time-entry limit. Narrow the source window or increase SNEUP_EVERHOUR_MAX_ENTRIES before continuing.');
      error.statusCode = 413;
      throw error;
    }

    const records = sourceEntries.map(timeEntry).filter(Boolean);
    const cursorDate = parseDate(cursor);
    const newest = records.reduce((latest, item) => {
      const updated = parseDate(item.updatedAt || item.spentDate || item.createdAt);
      return updated && (!latest || updated > latest) ? updated : latest;
    }, cursorDate);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'everhour_api',
        timeEntries: records.length,
        projects: new Set(records.map(record => record.project?.id).filter(Boolean)).size,
        contentPolicy: 'bounded_recent_time_entry_utilization_metadata_only_no_descriptions_notes_budgets_expenses_invoices_rates_people_profiles_or_provider_writes'
      }
    };
  }
}

const everhourWorkSignalClient = new EverhourWorkSignalClient();
module.exports = everhourWorkSignalClient;
module.exports.EverhourWorkSignalClient = EverhourWorkSignalClient;
