const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const TASKWORLD_ORIGINS = new Set(['https://us.taskworld.com', 'https://asia-api.taskworld.com', 'https://europe-api.taskworld.com']);
const TASKWORLD_PATH = '/api/public/v1';
const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const error = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const boundedText = value => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 160) : undefined;
};
const safeId = value => /^[A-Za-z0-9_-]{1,128}$/.test(String(value || ''));
const parseDate = value => {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const projectRecord = value => {
  const id = String(value?.project_id || value?.id || '');
  const createdAt = parseDate(value?.created);
  const updatedAt = parseDate(value?.updated);
  if (!safeId(id) || !boundedText(value?.title || value?.name) || (value?.created && !createdAt) || (value?.updated && !updatedAt) || (value?.is_deleted !== undefined && typeof value.is_deleted !== 'boolean')) return null;
  return compact({ id: `project:${id}`, sourceType: 'project', projectId: id, name: boundedText(value.title || value.name), status: value.is_deleted ? 'archived' : 'open', createdAt: createdAt?.toISOString(), updatedAt: updatedAt?.toISOString() });
};

class TaskworldWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig(account) {
    const raw = String(account?.metadata?.fields?.apiUrl || '').trim();
    const spaceId = String(account?.metadata?.fields?.spaceId || '').trim();
    let url;
    try { url = new URL(raw); } catch { url = null; }
    if (!url || !TASKWORLD_ORIGINS.has(url.origin) || url.username || url.password || url.port || url.pathname !== TASKWORLD_PATH || url.search || url.hash || !safeId(spaceId)) throw error('Taskworld API URL must be an allowlisted HTTPS region ending in /api/public/v1, and the workspace ID must be valid. Reconnect this account to continue syncing.', 400);
    return {
      apiUrl: `${url.origin}${TASKWORLD_PATH}/project.get-all`,
      spaceId,
      timeout: clamp(process.env.SNEUP_TASKWORLD_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clamp(process.env.SNEUP_TASKWORLD_MAX_PROJECTS, 500, 1, 1000),
      maxResponseBytes: clamp(process.env.SNEUP_TASKWORLD_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000),
      cursorLookbackMs: clamp(process.env.SNEUP_TASKWORLD_CURSOR_LOOKBACK_MS, 60000, 0, 24 * 60 * 60 * 1000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.apiKey || credentials.token || credentials.accessToken;
    if (!token) throw error('Taskworld API token is missing. Reconnect this account to continue syncing.', 503);
    return token;
  }

  request(config, accessToken) {
    return this.http.post(config.apiUrl, { access_token: accessToken, space_id: config.spaceId, limit: config.maxProjects }, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: 64 * 1024,
      maxRedirects: 0,
      proxy: false
    });
  }

  async fetchDelta(account, cursor) {
    const priorCursor = cursor ? parseDate(cursor) : null;
    if (cursor && !priorCursor) throw error('Taskworld work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const config = this.getConfig(account);
    const accessToken = this.getAccessToken(account);
    const cutoff = priorCursor ? new Date(priorCursor.getTime() - config.cursorLookbackMs) : null;
    const response = await this.request(config, accessToken);
    const projects = response?.data?.projects;
    if (response?.data?.ok !== true || !Array.isArray(projects) || projects.length > config.maxProjects) throw error('Taskworld returned an invalid or over-limit project metadata page. Reconnect this account before syncing again.');
    const normalized = projects.map(projectRecord);
    if (normalized.some(item => !item)) throw error('Taskworld returned invalid project metadata. Reconnect this account before syncing again.');
    if (projects.length === config.maxProjects) throw error('Taskworld sync reached its configured project limit. Increase SNEUP_TASKWORLD_MAX_PROJECTS before continuing; Sneup will not guess an undocumented continuation parameter.', 413);
    const records = normalized.filter(item => { const updatedAt = parseDate(item.updatedAt || item.createdAt); return !cutoff || !updatedAt || updatedAt >= cutoff; });
    const newest = records.reduce((latest, record) => {
      const date = parseDate(record.updatedAt || record.createdAt);
      return date && (!latest || date > latest) ? date : latest;
    }, priorCursor);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'taskworld_project_metadata', projects: records.length, pages: 1, contentPolicy: 'bounded_project_metadata_only_no_tasks_milestones_conversations_comments_checklists_files_people_descriptions_urls_or_provider_writes' } };
  }
}

const taskworldWorkSignalClient = new TaskworldWorkSignalClient();
module.exports = taskworldWorkSignalClient;
module.exports.TaskworldWorkSignalClient = TaskworldWorkSignalClient;
