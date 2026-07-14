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
const safeId = value => /^[A-Za-z0-9._!#%+-]{1,256}$/.test(String(value || '')) ? String(value) : undefined;
const date = value => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

const driveItem = item => {
  const itemId = safeId(item?.id);
  const name = boundedText(item?.name);
  const isFolder = Boolean(item?.folder || item?.package);
  if (!itemId || !name || item?.deleted) return null;
  return compact({
    id: `${isFolder ? 'folder' : 'file'}:${itemId}`,
    sourceType: isFolder ? 'folder' : 'file',
    itemId,
    name,
    status: 'open',
    createdAt: date(item.createdDateTime),
    updatedAt: date(item.lastModifiedDateTime)
  });
};

class OneDriveWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_ONEDRIVE_TIMEOUT_MS, 15000, 1000, 60000),
      maxItems: clamp(process.env.SNEUP_ONEDRIVE_MAX_ITEMS, 100, 1, 200),
      maxResponseBytes: clamp(process.env.SNEUP_ONEDRIVE_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000),
      cursorLookbackMs: clamp(process.env.SNEUP_ONEDRIVE_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('OneDrive access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  requestOptions(token, config) {
    return {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    };
  }

  boundedValues(payload, maximum) {
    const values = Array.isArray(payload?.value) ? payload.value : [];
    if (values.length >= maximum && payload?.['@odata.nextLink']) {
      const error = new Error('OneDrive sync reached its configured root-item limit. Increase SNEUP_ONEDRIVE_MAX_ITEMS before continuing.');
      error.statusCode = 413;
      throw error;
    }
    return values;
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
    const response = await this.http.get('https://graph.microsoft.com/v1.0/me/drive/root/children', {
      ...this.requestOptions(token, config),
      params: {
        '$top': config.maxItems,
        '$orderby': 'lastModifiedDateTime desc',
        '$select': 'id,name,folder,package,createdDateTime,lastModifiedDateTime,deleted'
      }
    });
    const records = this.boundedValues(response.data, config.maxItems)
      .map(driveItem)
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
        source: 'onedrive_graph_api',
        rootItems: records.length,
        contentPolicy: 'bounded_root_item_metadata_only_no_file_content_web_urls_permissions_versions_shared_links_or_provider_writes'
      }
    };
  }
}

const oneDriveWorkSignalClient = new OneDriveWorkSignalClient();
module.exports = oneDriveWorkSignalClient;
module.exports.OneDriveWorkSignalClient = OneDriveWorkSignalClient;
