const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const GRAPH_URL = 'https://graph.microsoft.com/v1.0';
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
const safeSiteId = value => /^[A-Za-z0-9._,-]{1,512}$/.test(String(value || '')) ? String(value) : undefined;
const safeItemId = value => /^[A-Za-z0-9._!#%+-]{1,256}$/.test(String(value || '')) ? String(value) : undefined;
const parseDate = value => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};
const invalidResponse = message => {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
};

const itemRecord = (item, siteId) => {
  const itemId = safeItemId(item?.id);
  const name = boundedText(item?.name);
  const isFolder = Boolean(item?.folder || item?.package);
  if (!itemId || !name || item?.deleted) return null;
  return compact({
    id: `${isFolder ? 'folder' : 'file'}:${itemId}`,
    sourceType: isFolder ? 'folder' : 'file',
    itemId,
    siteId,
    name,
    status: 'open',
    createdAt: parseDate(item.createdDateTime),
    updatedAt: parseDate(item.lastModifiedDateTime)
  });
};

class SharePointWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_SHAREPOINT_TIMEOUT_MS, 15000, 1000, 60000),
      maxItems: clamp(process.env.SNEUP_SHAREPOINT_MAX_ITEMS, 100, 1, 500),
      maxResponseBytes: clamp(process.env.SNEUP_SHAREPOINT_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000),
      cursorLookbackMs: clamp(process.env.SNEUP_SHAREPOINT_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('SharePoint access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  getSiteId(account) {
    const siteId = safeSiteId(account?.metadata?.fields?.sharePointSiteId);
    if (!siteId) {
      const error = new Error('Select one followed SharePoint site before syncing.');
      error.statusCode = 400;
      throw error;
    }
    return siteId;
  }

  boundedValues(payload, maximum) {
    const values = payload?.value;
    if (!Array.isArray(values)) throw invalidResponse('SharePoint returned an invalid root metadata collection. Reconnect this account before syncing again.');
    if (values.length > maximum || (values.length >= maximum && payload?.['@odata.nextLink'])) {
      const error = new Error('SharePoint sync reached its configured root-item limit. Increase SNEUP_SHAREPOINT_MAX_ITEMS before continuing.');
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
    const siteId = this.getSiteId(account);
    const cursorDate = cursor && !Number.isNaN(new Date(cursor).getTime()) ? new Date(cursor) : null;
    if (cursor && !cursorDate) {
      const error = new Error('SharePoint work-signal cursor is invalid. Reconnect this account to establish a new cursor.');
      error.statusCode = 400;
      throw error;
    }

    const response = await this.http.get(`${GRAPH_URL}/sites/${encodeURIComponent(siteId)}/drive/root/children`, {
      params: {
        '$top': config.maxItems,
        '$orderby': 'lastModifiedDateTime desc',
        '$select': 'id,name,folder,package,createdDateTime,lastModifiedDateTime,deleted'
      },
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
    const records = this.boundedValues(response.data, config.maxItems)
      .map(item => itemRecord(item, siteId))
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
        source: 'sharepoint_followed_site_root_metadata',
        siteSelected: true,
        rootItems: records.length,
        contentPolicy: 'one_selected_followed_sharepoint_site_root_metadata_only_no_file_contents_web_urls_permissions_pages_lists_people_versions_sharing_details_or_provider_writes'
      }
    };
  }
}

const sharePointWorkSignalClient = new SharePointWorkSignalClient();
module.exports = sharePointWorkSignalClient;
module.exports.SharePointWorkSignalClient = SharePointWorkSignalClient;
