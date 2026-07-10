const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const DEFAULT_API_URL = 'https://api.clickup.com/api/v2';

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

const parseDate = (value) => {
  if (!value) return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const sanitizeTask = (task, team) => ({
  id: task.id,
  name: task.name,
  url: task.url,
  status: task.status,
  priority: task.priority,
  assignees: task.assignees,
  tags: task.tags,
  due_date: task.due_date,
  start_date: task.start_date,
  date_created: task.date_created,
  date_updated: task.date_updated,
  date_done: task.date_done,
  date_closed: task.date_closed,
  parent: task.parent,
  dependencies: task.dependencies,
  linked_tasks: task.linked_tasks,
  space: task.space,
  folder: task.folder,
  list: task.list,
  project: task.project,
  team: { id: team.id, name: team.name }
});

class ClickUpWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      apiUrl: String(process.env.SNEUP_CLICKUP_API_URL || DEFAULT_API_URL).replace(/\/$/, ''),
      timeout: clampInteger(process.env.SNEUP_CLICKUP_TIMEOUT_MS, 15000, 1000, 60000),
      maxTeams: clampInteger(process.env.SNEUP_CLICKUP_MAX_TEAMS, 5, 1, 20),
      maxTasksPerTeam: clampInteger(process.env.SNEUP_CLICKUP_MAX_TASKS_PER_TEAM, 1000, 1, 5000),
      maxTotalTasks: clampInteger(process.env.SNEUP_CLICKUP_MAX_TOTAL_TASKS, 2500, 1, 10000),
      cursorLookbackMs: clampInteger(process.env.SNEUP_CLICKUP_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('ClickUp access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  request(path, token, config, params = {}) {
    return this.http.get(`${config.apiUrl}${path}`, {
      params,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      },
      timeout: config.timeout
    });
  }

  async listTeams(token, config) {
    const response = await this.request('/team', token, config);
    const teams = Array.isArray(response.data?.teams) ? response.data.teams.filter(team => team?.id) : [];
    if (teams.length > config.maxTeams) {
      const error = new Error('ClickUp sync reached its configured workspace limit. Increase SNEUP_CLICKUP_MAX_TEAMS before continuing.');
      error.statusCode = 413;
      throw error;
    }
    return teams;
  }

  async listTeamTasks(team, token, cursorDate, config, state) {
    let page = 0;
    let teamTaskCount = 0;
    let hasMore = true;
    const since = cursorDate ? cursorDate.getTime() - config.cursorLookbackMs : undefined;

    while (hasMore) {
      const remainingForTeam = config.maxTasksPerTeam - teamTaskCount;
      const remainingTotal = config.maxTotalTasks - state.fetchedTotal;
      if (remainingForTeam <= 0 || remainingTotal <= 0) {
        const error = new Error('ClickUp sync reached its configured task limit. Increase SNEUP_CLICKUP_MAX_TASKS_PER_TEAM or SNEUP_CLICKUP_MAX_TOTAL_TASKS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      const response = await this.request(`/team/${encodeURIComponent(team.id)}/task`, token, config, {
        page,
        order_by: 'updated',
        reverse: true,
        include_closed: true,
        subtasks: true,
        ...(since ? { date_updated_gt: since } : {})
      });
      const tasks = Array.isArray(response.data?.tasks) ? response.data.tasks : [];
      state.fetchedTotal += tasks.length;
      teamTaskCount += tasks.length;
      for (const task of tasks) {
        const record = sanitizeTask(task, team);
        const updatedAt = parseDate(record.date_updated || record.date_done || record.date_created);
        if (updatedAt && (!state.newest || updatedAt > state.newest)) state.newest = updatedAt;
        state.records.push(record);
      }
      hasMore = response.data?.last_page === false || (response.data?.last_page === undefined && tasks.length === 100);
      if (hasMore && tasks.length === 0) {
        const error = new Error('ClickUp returned an incomplete task page. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
      if (hasMore && (teamTaskCount >= config.maxTasksPerTeam || state.fetchedTotal >= config.maxTotalTasks)) {
        const error = new Error('ClickUp sync reached its configured task limit. Increase SNEUP_CLICKUP_MAX_TASKS_PER_TEAM or SNEUP_CLICKUP_MAX_TOTAL_TASKS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      page += 1;
    }
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const cursorDate = parseDate(cursor);
    const teams = await this.listTeams(token, config);
    if (teams.length === 0) {
      const error = new Error('No ClickUp workspaces are available to this account. Reconnect the account and authorize at least one workspace.');
      error.statusCode = 403;
      throw error;
    }
    const state = { records: [], fetchedTotal: 0, newest: cursorDate };
    for (const team of teams) {
      await this.listTeamTasks(team, token, cursorDate, config, state);
    }
    return {
      records: state.records,
      nextCursor: state.newest ? state.newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: { source: 'clickup_api', workspaces: teams.length, items: state.records.length }
    };
  }
}

const clickUpWorkSignalClient = new ClickUpWorkSignalClient();

module.exports = clickUpWorkSignalClient;
module.exports.ClickUpWorkSignalClient = ClickUpWorkSignalClient;
