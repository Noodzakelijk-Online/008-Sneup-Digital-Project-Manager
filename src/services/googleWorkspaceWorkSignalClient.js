const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const clamp = (value, fallback, max) => Math.max(1, Math.min(max, Number.parseInt(value, 10) || fallback));
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const error = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const parseDate = (value) => {
  if (value === undefined || value === null || value === '') return null;
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
const taskListRecord = item => {
  const updatedAt = parseDate(item?.updated);
  if (!item?.id || !boundedText(item.title) || (item.updated && !updatedAt)) return null;
  return compact({ id: `google_task_list:${item.id}`, externalId: `google_tasks:list:${item.id}`, googleSource: 'tasks', sourceType: 'task_list', taskListId: item.id, name: boundedText(item.title), updatedAt: updatedAt?.toISOString() });
};
const taskRecord = (item, taskList) => {
  const updatedAt = parseDate(item?.updated);
  const dueAt = parseDate(item?.due);
  const completedAt = parseDate(item?.completed);
  if (!item?.id || !boundedText(item.title) || !taskList?.taskListId || (item.updated && !updatedAt) || (item.due && !dueAt) || (item.completed && !completedAt) || (item.deleted !== undefined && typeof item.deleted !== 'boolean')) return null;
  return compact({ id: `google_task:${taskList.taskListId}:${item.id}`, externalId: `google_tasks:${taskList.taskListId}:${item.id}`, googleSource: 'tasks', sourceType: 'task', taskId: item.id, taskListId: taskList.taskListId, taskList: { id: taskList.taskListId, name: taskList.name }, name: boundedText(item.title), status: item.deleted ? 'deleted' : item.status === 'completed' ? 'done' : 'open', dueAt: dueAt?.toISOString(), completedAt: completedAt?.toISOString(), updatedAt: updatedAt?.toISOString() });
};

const calendarEvent = (event = {}, calendar = {}) => ({
  id: event.id,
  summary: event.summary,
  status: event.status,
  start: event.start && { dateTime: event.start.dateTime, date: event.start.date, timeZone: event.start.timeZone },
  end: event.end && { dateTime: event.end.dateTime, date: event.end.date, timeZone: event.end.timeZone },
  organizer: event.organizer && { email: event.organizer.email, displayName: event.organizer.displayName },
  creator: event.creator && { email: event.creator.email, displayName: event.creator.displayName },
  created: event.created,
  updated: event.updated,
  htmlLink: event.htmlLink,
  calendar: { id: calendar.id, name: calendar.summary }
});

class GoogleWorkspaceWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
    this.now = options.now || (() => new Date());
  }

  config() {
    return {
      calendarUrl: String(process.env.SNEUP_GOOGLE_CALENDAR_API_URL || 'https://www.googleapis.com/calendar/v3').replace(/\/$/, ''),
      driveUrl: String(process.env.SNEUP_GOOGLE_DRIVE_API_URL || 'https://www.googleapis.com/drive/v3').replace(/\/$/, ''),
      tasksUrl: 'https://tasks.googleapis.com/tasks/v1',
      timeout: clamp(process.env.SNEUP_GOOGLE_TIMEOUT_MS, 15000, 60000),
      maxCalendars: clamp(process.env.SNEUP_GOOGLE_MAX_CALENDARS, 10, 100),
      maxEventsPerCalendar: clamp(process.env.SNEUP_GOOGLE_MAX_EVENTS_PER_CALENDAR, 100, 1000),
      maxFiles: clamp(process.env.SNEUP_GOOGLE_MAX_FILES, 250, 1000),
      maxTaskLists: clamp(process.env.SNEUP_GOOGLE_MAX_TASK_LISTS, 25, 1000),
      maxTasksPerList: clamp(process.env.SNEUP_GOOGLE_MAX_TASKS_PER_LIST, 500, 5000),
      maxTotalTasks: clamp(process.env.SNEUP_GOOGLE_MAX_TOTAL_TASKS, 2500, 10000),
      maxResponseBytes: clamp(process.env.SNEUP_GOOGLE_MAX_RESPONSE_BYTES, 1000000, 5000000),
      lookbackMs: Math.max(0, Math.min(3600000, Number.parseInt(process.env.SNEUP_GOOGLE_CURSOR_LOOKBACK_MS, 10) || 60000))
    };
  }

  token(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('Google Workspace access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  options(token, config, params = {}) {
    return {
      params,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: 64 * 1024,
      maxRedirects: 0,
      proxy: false
    };
  }

  async listTasks(config, token, taskLists, since) {
    const tasks = [];
    for (const taskList of taskLists) {
      let pageToken;
      let fetchedForList = 0;
      while (true) {
        const remainingForList = config.maxTasksPerList - fetchedForList;
        const remainingTotal = config.maxTotalTasks - tasks.length;
        if (remainingForList <= 0 || remainingTotal <= 0) throw error('Google Tasks sync reached its configured task limit. Increase the relevant SNEUP_GOOGLE task limit before continuing.', 413);
        const maxResults = Math.min(100, remainingForList, remainingTotal);
        const response = await this.http.get(`${config.tasksUrl}/lists/${encodeURIComponent(taskList.taskListId)}/tasks`, this.options(token, config, {
          maxResults,
          showCompleted: true,
          showDeleted: true,
          showHidden: true,
          fields: 'items(id,title,status,due,completed,updated,deleted,hidden),nextPageToken',
          ...(since ? { updatedMin: since.toISOString() } : {}),
          ...(pageToken ? { pageToken } : {})
        }));
        const page = Array.isArray(response.data?.items) ? response.data.items : null;
        if (!page || page.length > maxResults) throw error('Google Tasks returned an invalid task page. Reconnect this account before syncing again.');
        const normalized = page.map(item => taskRecord(item, taskList));
        if (normalized.some(item => !item)) throw error('Google Tasks returned invalid task metadata. Reconnect this account before syncing again.');
        tasks.push(...normalized);
        fetchedForList += page.length;
        pageToken = response.data?.nextPageToken;
        if (!pageToken) break;
        if (page.length === 0) throw error('Google Tasks returned a non-progressing task page. Reconnect this account before syncing again.');
      }
    }
    return tasks;
  }

  async fetchDelta(account, cursor) {
    const config = this.config();
    const token = this.token(account);
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) throw error('Google Workspace work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const since = cursorDate ? new Date(cursorDate.getTime() - config.lookbackMs) : null;
    const [calendarResponse, driveResponse, taskListResponse] = await Promise.all([
      this.http.get(`${config.calendarUrl}/users/me/calendarList`, this.options(token, config, {
        maxResults: config.maxCalendars,
        fields: 'items(id,summary),nextPageToken'
      })),
      this.http.get(`${config.driveUrl}/files`, this.options(token, config, {
        pageSize: config.maxFiles,
        orderBy: 'modifiedTime desc',
        fields: 'files(id,name,mimeType,modifiedTime,createdTime,webViewLink,owners(displayName,emailAddress),trashed)'
      })),
      this.http.get(`${config.tasksUrl}/users/@me/lists`, this.options(token, config, {
        maxResults: config.maxTaskLists,
        fields: 'items(id,title,updated),nextPageToken'
      }))
    ]);
    const calendars = Array.isArray(calendarResponse.data?.items) ? calendarResponse.data.items : [];
    if (calendars.length >= config.maxCalendars && calendarResponse.data?.nextPageToken) {
      const error = new Error('Google Workspace sync reached its configured calendar limit. Increase SNEUP_GOOGLE_MAX_CALENDARS before continuing.');
      error.statusCode = 413;
      throw error;
    }
    const events = [];
    for (const calendar of calendars) {
      const response = await this.http.get(`${config.calendarUrl}/calendars/${encodeURIComponent(calendar.id)}/events`, this.options(token, config, {
        maxResults: config.maxEventsPerCalendar,
        singleEvents: true,
        orderBy: 'updated',
        fields: 'items(id,summary,status,start,end,organizer(email,displayName),creator(email,displayName),created,updated,htmlLink),nextPageToken',
        ...(since ? { updatedMin: since.toISOString() } : { timeMin: this.now().toISOString() })
      }));
      const page = Array.isArray(response.data?.items) ? response.data.items : [];
      if (page.length >= config.maxEventsPerCalendar && response.data?.nextPageToken) {
        const error = new Error(`Google calendar ${calendar.summary || calendar.id} reached its configured event limit.`);
        error.statusCode = 413;
        throw error;
      }
      events.push(...page.map(event => calendarEvent(event, calendar)));
    }
    const files = Array.isArray(driveResponse.data?.files) ? driveResponse.data.files : [];
    if (files.length >= config.maxFiles && driveResponse.data?.nextPageToken) {
      const error = new Error('Google Workspace sync reached its configured Drive metadata limit. Increase SNEUP_GOOGLE_MAX_FILES before continuing.');
      error.statusCode = 413;
      throw error;
    }
    const taskListItems = Array.isArray(taskListResponse.data?.items) ? taskListResponse.data.items : null;
    if (!taskListItems) throw error('Google Tasks returned an invalid task-list response. Reconnect this account before syncing again.');
    if (taskListItems.length >= config.maxTaskLists && taskListResponse.data?.nextPageToken) throw error('Google Tasks sync reached its configured task-list limit. Increase SNEUP_GOOGLE_MAX_TASK_LISTS before continuing.', 413);
    const taskLists = taskListItems.map(taskListRecord);
    if (taskLists.some(item => !item)) throw error('Google Tasks returned invalid task-list metadata. Reconnect this account before syncing again.');
    const tasks = await this.listTasks(config, token, taskLists, since);
    const records = [...events, ...files, ...taskLists, ...tasks];
    const newest = records.reduce((latest, record) => {
      const date = parseDate(record.updatedAt || record.updated || record.modifiedTime || record.created || record.createdTime);
      return date && (!latest || date > latest) ? date : latest;
    }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'google_workspace_api', calendars: calendars.length, files: files.length, taskLists: taskLists.length, tasks: tasks.length, contentPolicy: 'calendar_and_drive_metadata_plus_bounded_google_tasks_metadata_only_no_task_notes_links_assignments_or_provider_writes' } };
  }
}

const googleWorkspaceWorkSignalClient = new GoogleWorkspaceWorkSignalClient();
module.exports = googleWorkspaceWorkSignalClient;
module.exports.GoogleWorkspaceWorkSignalClient = GoogleWorkspaceWorkSignalClient;
