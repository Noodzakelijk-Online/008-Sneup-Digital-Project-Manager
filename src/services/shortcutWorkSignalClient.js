const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.app.shortcut.com/api/v3';
const APP_HOST = 'app.shortcut.com';

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

const safePermalink = (value) => {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === APP_HOST ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const uniqueIds = (items) => [...new Set(items.filter(Boolean).map(value => String(value)))];

const storyLinkContext = (story) => {
  const id = String(story.id);
  const context = { dependencies: [], dependents: [], duplicates: [], related: [] };
  for (const link of Array.isArray(story.story_links) ? story.story_links : []) {
    const subjectId = String(link.subject_id || '');
    const objectId = String(link.object_id || '');
    const peerId = subjectId === id ? objectId : objectId === id ? subjectId : '';
    if (!peerId) continue;
    if (link.verb === 'blocks') {
      if (objectId === id) context.dependencies.push(peerId);
      if (subjectId === id) context.dependents.push(peerId);
    } else if (link.verb === 'duplicates') {
      context.duplicates.push(peerId);
    } else if (link.verb === 'relates to') {
      context.related.push(peerId);
    }
  }
  return Object.fromEntries(Object.entries(context).map(([key, values]) => [key, uniqueIds(values)]));
};

const sanitizeProject = (project) => ({
  id: String(project.id),
  name: project.name,
  url: safePermalink(project.app_url),
  createdAt: project.created_at,
  updatedAt: project.updated_at
});

const sanitizeStory = (story, project) => ({
  id: String(story.id),
  title: story.name,
  completed: Boolean(story.completed),
  blocked: Boolean(story.blocked),
  started: Boolean(story.started),
  storyType: story.story_type,
  ownerIds: uniqueIds(Array.isArray(story.owner_ids) ? story.owner_ids : []),
  dueAt: story.deadline,
  createdAt: story.created_at,
  updatedAt: story.updated_at,
  url: safePermalink(story.app_url),
  project,
  ...storyLinkContext(story)
});

class ShortcutWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clampInteger(process.env.SNEUP_SHORTCUT_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clampInteger(process.env.SNEUP_SHORTCUT_MAX_PROJECTS, 25, 1, 100),
      maxStoriesPerProject: clampInteger(process.env.SNEUP_SHORTCUT_MAX_STORIES_PER_PROJECT, 250, 1, 1000),
      maxTotalStories: clampInteger(process.env.SNEUP_SHORTCUT_MAX_TOTAL_STORIES, 2500, 1, 10000),
      cursorLookbackMs: clampInteger(process.env.SNEUP_SHORTCUT_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.accessToken || credentials.apiKey;
    if (!token) {
      const error = new Error('Shortcut personal access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  request(path, token, config) {
    return this.http.get(`${API_URL}${path}`, {
      headers: {
        Accept: 'application/json',
        'Shortcut-Token': token
      },
      timeout: config.timeout
    });
  }

  async listProjects(token, config) {
    const response = await this.request('/projects', token, config);
    const projects = Array.isArray(response.data) ? response.data : [];
    if (projects.length > config.maxProjects) {
      const error = new Error('Shortcut sync reached its configured project limit. Increase SNEUP_SHORTCUT_MAX_PROJECTS before continuing.');
      error.statusCode = 413;
      throw error;
    }
    return projects.map(sanitizeProject);
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const cursorDate = parseDate(cursor);
    const minimumUpdatedAt = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : null;
    const projects = await this.listProjects(token, config);
    const records = [];
    let newest = cursorDate;

    for (const project of projects) {
      const response = await this.request(`/projects/${encodeURIComponent(project.id)}/stories`, token, config);
      const stories = Array.isArray(response.data) ? response.data : [];
      if (stories.length > config.maxStoriesPerProject || records.length + stories.length > config.maxTotalStories) {
        const error = new Error('Shortcut sync reached its configured story limit. Increase SNEUP_SHORTCUT_MAX_STORIES_PER_PROJECT or SNEUP_SHORTCUT_MAX_TOTAL_STORIES before continuing.');
        error.statusCode = 413;
        throw error;
      }
      for (const story of stories) {
        const record = sanitizeStory(story, project);
        const updatedAt = parseDate(record.updatedAt || record.createdAt);
        if (updatedAt && (!newest || updatedAt > newest)) newest = updatedAt;
        if (!minimumUpdatedAt || !updatedAt || updatedAt >= minimumUpdatedAt) records.push(record);
      }
    }

    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: { source: 'shortcut_api', projects: projects.length, items: records.length }
    };
  }
}

const shortcutWorkSignalClient = new ShortcutWorkSignalClient();

module.exports = shortcutWorkSignalClient;
module.exports.ShortcutWorkSignalClient = ShortcutWorkSignalClient;
