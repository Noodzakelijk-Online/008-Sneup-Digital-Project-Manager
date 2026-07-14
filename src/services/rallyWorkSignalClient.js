const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://rally1.rallydev.com/slm/webservice/v2.0';
const STORY_FIELDS = 'ObjectID,FormattedID,Name,ScheduleState,Priority,PlanEstimate,Blocked,CreationDate,LastUpdateDate';
const DEFECT_FIELDS = 'ObjectID,FormattedID,Name,State,Priority,PlanEstimate,Blocked,CreationDate,LastUpdateDate';

const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const validFormattedId = value => /^(?:US|DE)[1-9][0-9]{0,19}$/i.test(String(value || ''));
const parseDate = value => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const boundedText = value => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 160) : undefined;
};
const scalar = value => typeof value === 'string' || typeof value === 'number'
  ? String(value)
  : value && typeof value._refObjectName === 'string' ? boundedText(value._refObjectName) : undefined;

const sanitizeArtifact = (artifact, sourceType) => {
  const objectId = String(artifact?.ObjectID || '');
  const formattedId = String(artifact?.FormattedID || '');
  const createdAt = parseDate(artifact?.CreationDate);
  const updatedAt = parseDate(artifact?.LastUpdateDate);
  const status = scalar(sourceType === 'defect' ? artifact?.State : artifact?.ScheduleState);
  const priority = scalar(artifact?.Priority);
  const planEstimate = Number(artifact?.PlanEstimate);
  if (!validId(objectId) || !validFormattedId(formattedId) || !boundedText(artifact?.Name)
    || (artifact?.CreationDate && !createdAt) || (artifact?.LastUpdateDate && !updatedAt)
    || (artifact?.Blocked !== undefined && typeof artifact.Blocked !== 'boolean')
    || (artifact?.PlanEstimate !== undefined && !Number.isFinite(planEstimate))) return null;
  return compact({
    id: `${sourceType}:${objectId}`,
    sourceType,
    objectId,
    formattedId: formattedId.toUpperCase(),
    name: boundedText(artifact.Name),
    status: boundedText(status),
    priority: boundedText(priority),
    planEstimate: Number.isFinite(planEstimate) ? planEstimate : undefined,
    blocked: artifact.Blocked,
    createdAt: createdAt?.toISOString(),
    updatedAt: updatedAt?.toISOString()
  });
};

class RallyWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_RALLY_TIMEOUT_MS, 15000, 1000, 60000),
      maxUserStories: clamp(process.env.SNEUP_RALLY_MAX_USER_STORIES, 2500, 1, 10000),
      maxDefects: clamp(process.env.SNEUP_RALLY_MAX_DEFECTS, 2500, 1, 10000),
      pageSize: clamp(process.env.SNEUP_RALLY_PAGE_SIZE, 200, 1, 2000)
    };
  }

  getApiKey(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const apiKey = credentials.apiKey || credentials.token || credentials.accessToken;
    if (!apiKey) {
      const error = new Error('Rally API key is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return apiKey.startsWith('_') ? apiKey : `_${apiKey}`;
  }

  async listArtifacts({ endpoint, fields, sourceType, limit, config, apiKey, cursorDate }) {
    const records = [];
    let start = 1;
    let pages = 0;
    while (true) {
      const remaining = limit - records.length;
      if (remaining <= 0) {
        const error = new Error(`Rally sync reached its configured ${sourceType.replace('_', ' ')} limit. Increase the corresponding SNEUP_RALLY limit before continuing.`);
        error.statusCode = 413;
        throw error;
      }
      const response = await this.http.get(`${API_URL}/${endpoint}`, {
        params: { fetch: fields, pagesize: Math.min(config.pageSize, remaining), start, order: 'LastUpdateDate DESC' },
        headers: { Accept: 'application/json', zsessionid: apiKey },
        timeout: config.timeout,
        maxRedirects: 0,
        proxy: false
      });
      const result = response?.data?.QueryResult;
      const page = result?.Results;
      const total = Number(result?.TotalResultCount);
      if (!Array.isArray(page) || !Number.isInteger(total) || total < 0 || total > limit || page.length > remaining) {
        const error = new Error('Rally returned an invalid or over-limit work-item page. Reconnect this account before syncing again.');
        error.statusCode = total > limit ? 413 : 502;
        throw error;
      }
      const normalized = page.map(item => sanitizeArtifact(item, sourceType));
      if (normalized.some(item => !item)) {
        const error = new Error('Rally returned an invalid work-item metadata record. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
      records.push(...normalized.filter(item => {
        const updatedAt = parseDate(item.updatedAt || item.createdAt);
        return !cursorDate || !updatedAt || updatedAt >= cursorDate;
      }));
      pages += 1;
      if (start + page.length > total) return { records, pages };
      if (page.length === 0 || page.length < Math.min(config.pageSize, remaining)) {
        const error = new Error('Rally returned an incomplete work-item page. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
      start += page.length;
    }
  }

  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) {
      const error = new Error('Rally work-signal cursor is invalid. Reconnect this account to establish a new cursor.');
      error.statusCode = 400;
      throw error;
    }
    const config = this.getConfig();
    const apiKey = this.getApiKey(account);
    const [stories, defects] = await Promise.all([
      this.listArtifacts({ endpoint: 'hierarchicalrequirement', fields: STORY_FIELDS, sourceType: 'user_story', limit: config.maxUserStories, config, apiKey, cursorDate }),
      this.listArtifacts({ endpoint: 'defect', fields: DEFECT_FIELDS, sourceType: 'defect', limit: config.maxDefects, config, apiKey, cursorDate })
    ]);
    const records = [...stories.records, ...defects.records];
    const newest = records.reduce((latest, record) => {
      const date = parseDate(record.updatedAt || record.createdAt);
      return date && (!latest || date > latest) ? date : latest;
    }, cursorDate);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'rally_wsapi',
        userStories: stories.records.length,
        defects: defects.records.length,
        pages: stories.pages + defects.pages,
        contentPolicy: 'current_user_story_and_defect_metadata_only_no_descriptions_blocked_reasons_users_attachments_custom_fields_comments_urls_or_provider_writes'
      }
    };
  }
}

const rallyWorkSignalClient = new RallyWorkSignalClient();
module.exports = rallyWorkSignalClient;
module.exports.RallyWorkSignalClient = RallyWorkSignalClient;
