const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.figma.com/v1';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const validTeamId = value => /^\d{1,24}$/.test(String(value || ''));
const validProjectId = value => /^\d{1,24}$/.test(String(value || ''));
const validFileKey = value => /^[A-Za-z0-9_-]{6,128}$/.test(String(value || ''));
const parseDate = value => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const invalidResponse = message => { const error = new Error(message); error.statusCode = 502; return error; };

const project = item => validProjectId(item?.id) ? compact({ id: `project:${item.id}`, sourceType: 'project', projectId: String(item.id), name: boundedText(item.name) || `Figma project ${item.id}`, status: 'open' }) : null;
const file = (item, parent) => {
  const modifiedAt = parseDate(item?.last_modified);
  if (!validFileKey(item?.key) || (item?.last_modified && !modifiedAt)) return null;
  return compact({ id: `file:${item.key}`, sourceType: 'file', fileKey: item.key, projectId: parent.projectId, projectName: parent.name, name: boundedText(item.name) || `Figma file ${item.key}`, status: 'open', updatedAt: modifiedAt?.toISOString() });
};

class FigmaWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.now = options.now || (() => new Date()); }
  getConfig() { return { timeout: clamp(process.env.SNEUP_FIGMA_TIMEOUT_MS, 15000, 1000, 60000), maxProjects: clamp(process.env.SNEUP_FIGMA_MAX_PROJECTS, 250, 1, 1000), maxFilesPerProject: clamp(process.env.SNEUP_FIGMA_MAX_FILES_PER_PROJECT, 1000, 1, 5000), maxFiles: clamp(process.env.SNEUP_FIGMA_MAX_FILES, 5000, 1, 10000), initialLookbackDays: clamp(process.env.SNEUP_FIGMA_INITIAL_LOOKBACK_DAYS, 30, 1, 90) }; }
  getAccessToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.accessToken || credentials.token; if (!token) { const error = new Error('Figma OAuth access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }
  getTeamId(account) { const teamId = String(account?.metadata?.fields?.figmaTeamId || '').trim(); if (!validTeamId(teamId)) { const error = new Error('Select a Figma team ID before syncing this account.'); error.statusCode = 409; throw error; } return teamId; }
  request(path, token, config) { return this.http.get(`${API_URL}${path}`, { headers: { Accept: 'application/json', 'X-Figma-Token': token, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }
  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) { const error = new Error('Figma work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const config = this.getConfig(); const token = this.getAccessToken(account); const teamId = this.getTeamId(account);
    const projectsResponse = await this.request(`/teams/${encodeURIComponent(teamId)}/projects`, token, config); const projects = projectsResponse?.data?.projects;
    if (!Array.isArray(projects)) throw invalidResponse('Figma returned an invalid project collection. Reconnect this account before syncing again.');
    if (projects.length > config.maxProjects) { const error = new Error('Figma sync reached its configured project limit. Increase SNEUP_FIGMA_MAX_PROJECTS before continuing.'); error.statusCode = 413; throw error; }
    const normalizedProjects = projects.map(project).filter(Boolean);
    if (normalizedProjects.length !== projects.length) throw invalidResponse('Figma returned an invalid project identifier. Reconnect this account before syncing again.');
    const threshold = cursorDate || new Date(this.now().getTime() - config.initialLookbackDays * 86400000); const records = [...normalizedProjects]; let files = 0; let newest = cursorDate;
    for (const currentProject of normalizedProjects) {
      const response = await this.request(`/projects/${encodeURIComponent(currentProject.projectId)}/files`, token, config); const values = response?.data?.files;
      if (!Array.isArray(values)) throw invalidResponse('Figma returned an invalid project file collection. Reconnect this account before syncing again.');
      if (values.length > config.maxFilesPerProject || files + values.length > config.maxFiles) { const error = new Error('Figma sync reached its configured file limit. Increase SNEUP_FIGMA_MAX_FILES_PER_PROJECT or SNEUP_FIGMA_MAX_FILES before continuing.'); error.statusCode = 413; throw error; }
      const normalizedFiles = values.map(item => file(item, currentProject));
      if (normalizedFiles.some(item => !item)) throw invalidResponse('Figma returned an invalid file identifier or modification time. Reconnect this account before syncing again.');
      files += normalizedFiles.length;
      normalizedFiles.forEach(item => { const updatedAt = parseDate(item.updatedAt); if (!updatedAt || updatedAt >= threshold) records.push(item); if (updatedAt && (!newest || updatedAt > newest)) newest = updatedAt; });
    }
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'figma_project_file_metadata', teamId, projects: normalizedProjects.length, files, contentPolicy: 'project_and_file_metadata_only_no_file_content_nodes_comments_users_thumbnails_urls_versions_branch_data_or_provider_writes' } };
  }
}

const figmaWorkSignalClient = new FigmaWorkSignalClient();
module.exports = figmaWorkSignalClient;
module.exports.FigmaWorkSignalClient = FigmaWorkSignalClient;
