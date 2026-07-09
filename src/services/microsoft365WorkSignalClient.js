const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

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

class Microsoft365WorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      apiUrl: String(process.env.SNEUP_MICROSOFT_GRAPH_API_URL || 'https://graph.microsoft.com/v1.0').replace(/\/$/, ''),
      timeout: clampInteger(process.env.SNEUP_MICROSOFT_TIMEOUT_MS, 15000, 1000, 60000),
      maxEvents: clampInteger(process.env.SNEUP_MICROSOFT_MAX_EVENTS, 250, 1, 1000),
      maxTaskLists: clampInteger(process.env.SNEUP_MICROSOFT_MAX_TASK_LISTS, 25, 1, 100),
      maxTasksPerList: clampInteger(process.env.SNEUP_MICROSOFT_MAX_TASKS_PER_LIST, 100, 1, 1000),
      maxTotalTasks: clampInteger(process.env.SNEUP_MICROSOFT_MAX_TOTAL_TASKS, 1000, 1, 5000),
      maxFiles: clampInteger(process.env.SNEUP_MICROSOFT_MAX_FILES, 250, 1, 1000),
      cursorLookbackMs: clampInteger(process.env.SNEUP_MICROSOFT_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('Microsoft 365 access token is missing. Reconnect this account to continue syncing.');
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

  boundedValues(response, limit, message) {
    const values = Array.isArray(response.data?.value) ? response.data.value : [];
    if (values.length >= limit && response.data?.['@odata.nextLink']) {
      const error = new Error(message);
      error.statusCode = 413;
      throw error;
    }
    return values;
  }

  isWithinCursor(record, cursorDate, config) {
    if (!cursorDate) return true;
    const updatedAt = parseDate(record.lastModifiedDateTime || record.createdDateTime);
    return !updatedAt || updatedAt >= new Date(cursorDate.getTime() - config.cursorLookbackMs);
  }

  async listTodoTasks(list, token, config, cursorDate) {
    const response = await this.request(`/me/todo/lists/${encodeURIComponent(list.id)}/tasks`, token, config, {
      '$top': config.maxTasksPerList,
      '$orderby': 'lastModifiedDateTime desc',
      '$select': 'id,title,status,importance,categories,dueDateTime,completedDateTime,createdDateTime,lastModifiedDateTime,linkedResources'
    });
    const tasks = this.boundedValues(
      response,
      config.maxTasksPerList,
      `Microsoft To Do list ${list.displayName || list.id} reached its configured task limit. Increase SNEUP_MICROSOFT_MAX_TASKS_PER_LIST before continuing.`
    );
    return tasks
      .filter(task => this.isWithinCursor(task, cursorDate, config))
      .map(task => ({ ...task, microsoftSource: 'todo', todoList: { id: list.id, name: list.displayName } }));
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const cursorDate = parseDate(cursor);
    const [eventsResponse, taskListsResponse, filesResponse] = await Promise.all([
      this.request('/me/events', token, config, {
        '$top': config.maxEvents,
        '$orderby': 'lastModifiedDateTime desc',
        '$select': 'id,subject,start,end,organizer,categories,importance,isCancelled,createdDateTime,lastModifiedDateTime,webLink'
      }),
      this.request('/me/todo/lists', token, config, {
        '$top': config.maxTaskLists,
        '$select': 'id,displayName,isOwner,isShared,wellknownListName'
      }),
      this.request('/me/drive/root/children', token, config, {
        '$top': config.maxFiles,
        '$orderby': 'lastModifiedDateTime desc',
        '$select': 'id,name,file,folder,createdDateTime,lastModifiedDateTime,webUrl,deleted,parentReference,remoteItem'
      })
    ]);

    const events = this.boundedValues(
      eventsResponse,
      config.maxEvents,
      'Microsoft calendar sync reached its configured event limit. Increase SNEUP_MICROSOFT_MAX_EVENTS before continuing.'
    )
      .filter(event => this.isWithinCursor(event, cursorDate, config))
      .map(event => ({ ...event, microsoftSource: 'calendar' }));
    const taskLists = this.boundedValues(
      taskListsResponse,
      config.maxTaskLists,
      'Microsoft To Do sync reached its configured list limit. Increase SNEUP_MICROSOFT_MAX_TASK_LISTS before continuing.'
    );
    const files = this.boundedValues(
      filesResponse,
      config.maxFiles,
      'Microsoft OneDrive metadata sync reached its configured file limit. Increase SNEUP_MICROSOFT_MAX_FILES before continuing.'
    )
      .filter(file => this.isWithinCursor(file, cursorDate, config))
      .map(file => ({ ...file, microsoftSource: 'onedrive' }));

    const todoTasks = [];
    for (const list of taskLists) {
      const tasks = await this.listTodoTasks(list, token, config, cursorDate);
      if (todoTasks.length + tasks.length > config.maxTotalTasks) {
        const error = new Error('Microsoft To Do sync reached its configured total-task limit. Increase SNEUP_MICROSOFT_MAX_TOTAL_TASKS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      todoTasks.push(...tasks);
    }

    const records = [...events, ...todoTasks, ...files];
    const newest = records.reduce((latest, record) => {
      const updatedAt = parseDate(record.lastModifiedDateTime || record.createdDateTime);
      return updatedAt && (!latest || updatedAt > latest) ? updatedAt : latest;
    }, cursorDate);

    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'microsoft_graph',
        events: events.length,
        taskLists: taskLists.length,
        todoTasks: todoTasks.length,
        files: files.length
      }
    };
  }
}

const microsoft365WorkSignalClient = new Microsoft365WorkSignalClient();

module.exports = microsoft365WorkSignalClient;
module.exports.Microsoft365WorkSignalClient = Microsoft365WorkSignalClient;
