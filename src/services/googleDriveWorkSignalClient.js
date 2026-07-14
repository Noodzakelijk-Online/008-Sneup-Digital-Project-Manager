const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = (value, maximum = 160) => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, maximum) : undefined;
};
const safeId = value => /^[A-Za-z0-9_-]{1,256}$/.test(String(value || '')) ? String(value) : undefined;
const parseDate = value => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

const driveRecord = item => {
  const itemId = safeId(item?.id);
  const name = boundedText(item?.name);
  const isFolder = item?.mimeType === 'application/vnd.google-apps.folder';
  if (!itemId || !name || item?.trashed) return null;
  return compact({
    id: `${isFolder ? 'folder' : 'file'}:${itemId}`,
    sourceType: isFolder ? 'folder' : 'file',
    itemId,
    name,
    status: 'open',
    createdAt: parseDate(item.createdTime),
    updatedAt: parseDate(item.modifiedTime)
  });
};

class GoogleDriveWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_GOOGLE_DRIVE_TIMEOUT_MS, 15000, 1000, 60000),
      maxFiles: clamp(process.env.SNEUP_GOOGLE_DRIVE_MAX_FILES, 100, 1, 1000),
      maxResponseBytes: clamp(process.env.SNEUP_GOOGLE_DRIVE_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000),
      cursorLookbackMs: clamp(process.env.SNEUP_GOOGLE_DRIVE_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('Google Drive access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  assertBounded(payload) {
    if (!Array.isArray(payload?.files)) {
      const error = new Error('Google Drive response must contain a files array.');
      error.statusCode = 502;
      throw error;
    }
    if (payload.nextPageToken || payload.incompleteSearch) {
      const error = new Error('Google Drive sync reached an incomplete page. Narrow the Drive scope or increase SNEUP_GOOGLE_DRIVE_MAX_FILES before continuing.');
      error.statusCode = 413;
      throw error;
    }
    return payload.files;
  }

  isWithinCursor(item, cursor, config) {
    if (!cursor) return true;
    const updated = new Date(item.updatedAt || item.createdAt || 0).getTime();
    return !Number.isFinite(updated) || updated >= cursor.getTime() - config.cursorLookbackMs;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const cursorDate = cursor && !Number.isNaN(new Date(cursor).getTime()) ? new Date(cursor) : null;
    const response = await this.http.get('https://www.googleapis.com/drive/v3/files', {
      params: {
        pageSize: config.maxFiles,
        orderBy: 'modifiedTime desc',
        q: 'trashed = false',
        corpora: 'user',
        spaces: 'drive',
        includeItemsFromAllDrives: false,
        fields: 'files(id,name,mimeType,createdTime,modifiedTime,trashed),nextPageToken,incompleteSearch'
      },
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
    const records = this.assertBounded(response.data)
      .map(driveRecord)
      .filter(Boolean)
      .filter(item => this.isWithinCursor(item, cursorDate, config));
    const newest = records.reduce((latest, item) => {
      const updated = new Date(item.updatedAt || item.createdAt || 0);
      return !Number.isNaN(updated.getTime()) && (!latest || updated > latest) ? updated : latest;
    }, cursorDate);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'google_drive_api',
        items: records.length,
        contentPolicy: 'bounded_user_drive_metadata_only_no_file_content_web_urls_permissions_owners_shared_drives_or_provider_writes'
      }
    };
  }
}

const googleDriveWorkSignalClient = new GoogleDriveWorkSignalClient();
module.exports = googleDriveWorkSignalClient;
module.exports.GoogleDriveWorkSignalClient = GoogleDriveWorkSignalClient;
