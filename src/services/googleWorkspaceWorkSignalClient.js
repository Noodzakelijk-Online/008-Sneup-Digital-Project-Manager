const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const clamp = (value, fallback, max) => Math.max(1, Math.min(max, Number.parseInt(value, 10) || fallback));
const parseDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

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
      timeout: clamp(process.env.SNEUP_GOOGLE_TIMEOUT_MS, 15000, 60000),
      maxCalendars: clamp(process.env.SNEUP_GOOGLE_MAX_CALENDARS, 10, 100),
      maxEventsPerCalendar: clamp(process.env.SNEUP_GOOGLE_MAX_EVENTS_PER_CALENDAR, 100, 1000),
      maxFiles: clamp(process.env.SNEUP_GOOGLE_MAX_FILES, 250, 1000),
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
    return { params, headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, timeout: config.timeout };
  }

  async fetchDelta(account, cursor) {
    const config = this.config();
    const token = this.token(account);
    const cursorDate = cursor ? parseDate(cursor) : null;
    const since = cursorDate ? new Date(cursorDate.getTime() - config.lookbackMs) : null;
    const [calendarResponse, driveResponse] = await Promise.all([
      this.http.get(`${config.calendarUrl}/users/me/calendarList`, this.options(token, config, { maxResults: config.maxCalendars })),
      this.http.get(`${config.driveUrl}/files`, this.options(token, config, {
        pageSize: config.maxFiles,
        orderBy: 'modifiedTime desc',
        fields: 'files(id,name,mimeType,modifiedTime,createdTime,webViewLink,owners(displayName,emailAddress),trashed)'
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
        ...(since ? { updatedMin: since.toISOString() } : { timeMin: this.now().toISOString() })
      }));
      const page = Array.isArray(response.data?.items) ? response.data.items : [];
      if (page.length >= config.maxEventsPerCalendar && response.data?.nextPageToken) {
        const error = new Error(`Google calendar ${calendar.summary || calendar.id} reached its configured event limit.`);
        error.statusCode = 413;
        throw error;
      }
      events.push(...page.map(event => ({ ...event, calendar: { id: calendar.id, name: calendar.summary } })));
    }
    const files = Array.isArray(driveResponse.data?.files) ? driveResponse.data.files : [];
    if (files.length >= config.maxFiles && driveResponse.data?.nextPageToken) {
      const error = new Error('Google Workspace sync reached its configured Drive metadata limit. Increase SNEUP_GOOGLE_MAX_FILES before continuing.');
      error.statusCode = 413;
      throw error;
    }
    const records = [...events, ...files];
    const newest = records.reduce((latest, record) => {
      const date = parseDate(record.updated || record.modifiedTime || record.created || record.createdTime);
      return date && (!latest || date > latest) ? date : latest;
    }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'google_workspace_api', calendars: calendars.length, files: files.length } };
  }
}

const googleWorkspaceWorkSignalClient = new GoogleWorkspaceWorkSignalClient();
module.exports = googleWorkspaceWorkSignalClient;
module.exports.GoogleWorkspaceWorkSignalClient = GoogleWorkspaceWorkSignalClient;
