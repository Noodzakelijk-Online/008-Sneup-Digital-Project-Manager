const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const parseDate = value => { const parsed = new Date(value); return value && !Number.isNaN(parsed.getTime()) ? parsed : null; };
const project = item => validId(item?.id) && item.name ? compact({ id: `project:${item.id}`, sourceType: 'project', projectId: item.id, name: item.name, status: item.status === 1 ? 'active' : String(item.status), createdAt: item.created_at, updatedAt: item.updated_at || item.created_at }) : null;
const section = (item, projects) => validId(item?.id) && item.name ? compact({ id: `section:${item.id}`, sourceType: 'section', sectionId: item.id, projectId: item.project_id, name: item.name, project: projects.get(String(item.project_id)), status: item.status === 1 ? 'active' : String(item.status), sequence: item.sequence, createdAt: item.created_at, updatedAt: item.updated_at || item.created_at }) : null;
const task = (item, projects, sections) => validId(item?.id) && item.name ? compact({ id: `task:${item.id}`, sourceType: 'task', taskId: item.id, projectId: item.project_id, sectionId: item.section_id, name: item.name, project: projects.get(String(item.project_id)), section: sections.get(String(item.section_id)), status: item.status === 2 || item.status === 18 ? 'completed' : 'open', assigneeId: item.assigned_to_id, dueAt: item.due, createdAt: item.created_at, updatedAt: item.updated_at || item.status_updated_at || item.created_at }) : null;

class MeisterTaskWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig() { return { apiUrl: 'https://www.meistertask.com/api', timeout: clamp(process.env.SNEUP_MEISTERTASK_TIMEOUT_MS, 15000, 1000, 60000), maxProjects: clamp(process.env.SNEUP_MEISTERTASK_MAX_PROJECTS, 100, 1, 500), maxSections: clamp(process.env.SNEUP_MEISTERTASK_MAX_SECTIONS, 1000, 1, 5000), maxTasks: clamp(process.env.SNEUP_MEISTERTASK_MAX_TASKS, 2500, 1, 10000), pageSize: clamp(process.env.SNEUP_MEISTERTASK_PAGE_SIZE, 250, 1, 500), lookback: clamp(process.env.SNEUP_MEISTERTASK_CURSOR_LOOKBACK_MS, 60000, 0, 3600000) }; }

  getToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.token || credentials.accessToken || credentials.apiKey; if (!token) { const error = new Error('MeisterTask personal access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }

  request(config, token, path, params) { return this.http.get(`${config.apiUrl}${path}`, { params, headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }

  async listPaged(config, token, { path, limit, label, params, sanitize }) {
    const records = []; const seen = new Set(); let page = 1; let fetched = 0;
    while (true) {
      const remaining = limit - fetched;
      if (remaining <= 0) { const error = new Error(`MeisterTask sync reached its configured ${label} limit. Increase the corresponding SNEUP_MEISTERTASK limit before continuing.`); error.statusCode = 413; throw error; }
      const items = Math.min(config.pageSize, remaining); const response = await this.request(config, token, path, { ...params, items, page, sort: 'id' }); const raw = response.data;
      if (!Array.isArray(raw) || raw.length > items) { const error = new Error(`MeisterTask returned an invalid ${label} page. Reconnect this account before syncing again.`); error.statusCode = 502; throw error; }
      fetched += raw.length;
      for (const item of raw) { const record = sanitize(item); if (record && !seen.has(record.id)) { seen.add(record.id); records.push(record); } }
      if (raw.length < items) return records;
      if (fetched >= limit) { const error = new Error(`MeisterTask sync reached its configured ${label} limit. Increase the corresponding SNEUP_MEISTERTASK limit before continuing.`); error.statusCode = 413; throw error; }
      page += 1;
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const token = this.getToken(account); const cursorDate = parseDate(cursor);
    const projects = await this.listPaged(config, token, { path: '/projects', limit: config.maxProjects, label: 'project', params: { status: 'active' }, sanitize: project });
    const projectMap = new Map(projects.map(item => [String(item.projectId), { id: item.projectId, name: item.name }]));
    const sections = await this.listPaged(config, token, { path: '/sections', limit: config.maxSections, label: 'section', params: { status: 'active' }, sanitize: item => section(item, projectMap) });
    const sectionMap = new Map(sections.map(item => [String(item.sectionId), { id: item.sectionId, name: item.name }]));
    const tasks = await this.listPaged(config, token, { path: '/tasks', limit: config.maxTasks, label: 'task', params: {}, sanitize: item => task(item, projectMap, sectionMap) });
    const records = [...projects, ...sections, ...tasks].filter(item => { const updated = parseDate(item.updatedAt || item.createdAt); return !cursorDate || !updated || updated >= new Date(cursorDate.getTime() - config.lookback); });
    const newest = records.reduce((latest, item) => { const updated = parseDate(item.updatedAt || item.createdAt); return updated && (!latest || updated > latest) ? updated : latest; }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'meistertask_api', projects: projects.length, sections: sections.length, tasks: tasks.length, contentPolicy: 'project_section_task_metadata_only_no_notes_comments_checklists_attachments_labels_tokens_tracked_time_or_provider_writes' } };
  }
}

const meisterTaskWorkSignalClient = new MeisterTaskWorkSignalClient();
module.exports = meisterTaskWorkSignalClient;
module.exports.MeisterTaskWorkSignalClient = MeisterTaskWorkSignalClient;
