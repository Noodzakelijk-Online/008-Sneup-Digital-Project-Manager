const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const GOOGLE_FORMS_MIME_TYPE = 'application/vnd.google-apps.form';
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
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};
const invalidResponse = message => {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
};

const formRecord = form => {
  const formId = safeId(form?.id);
  const name = boundedText(form?.name);
  const createdAt = parseDate(form?.createdTime);
  const updatedAt = parseDate(form?.modifiedTime);
  if (!formId || !name || form?.trashed || form?.mimeType !== GOOGLE_FORMS_MIME_TYPE || (form?.createdTime && !createdAt) || (form?.modifiedTime && !updatedAt)) return null;
  return compact({ id: `form:${formId}`, sourceType: 'form', formId, name, status: 'open', createdAt, updatedAt });
};

class GoogleFormsWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_GOOGLE_FORMS_TIMEOUT_MS, 15000, 1000, 60000),
      maxForms: clamp(process.env.SNEUP_GOOGLE_FORMS_MAX_FORMS, 100, 1, 1000),
      maxResponseBytes: clamp(process.env.SNEUP_GOOGLE_FORMS_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000),
      cursorLookbackMs: clamp(process.env.SNEUP_GOOGLE_FORMS_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('Google Forms access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  assertBounded(payload, config) {
    if (!Array.isArray(payload?.files)) throw invalidResponse('Google Forms returned an invalid metadata collection. Reconnect this account before syncing again.');
    if (payload.files.length > config.maxForms || payload.nextPageToken || payload.incompleteSearch) {
      const error = new Error('Google Forms sync reached an incomplete metadata page. Increase SNEUP_GOOGLE_FORMS_MAX_FORMS before continuing.');
      error.statusCode = 413;
      throw error;
    }
    return payload.files;
  }

  isWithinCursor(form, cursor, config) {
    if (!cursor) return true;
    const updated = new Date(form.updatedAt || form.createdAt || 0).getTime();
    return !Number.isFinite(updated) || updated >= cursor.getTime() - config.cursorLookbackMs;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const cursorDate = cursor && !Number.isNaN(new Date(cursor).getTime()) ? new Date(cursor) : null;
    if (cursor && !cursorDate) {
      const error = new Error('Google Forms work-signal cursor is invalid. Reconnect this account to establish a new cursor.');
      error.statusCode = 400;
      throw error;
    }
    const response = await this.http.get('https://www.googleapis.com/drive/v3/files', {
      params: {
        pageSize: config.maxForms,
        orderBy: 'modifiedTime desc',
        q: `mimeType = '${GOOGLE_FORMS_MIME_TYPE}' and trashed = false`,
        corpora: 'user',
        spaces: 'drive',
        includeItemsFromAllDrives: false,
        fields: 'files(id,name,mimeType,createdTime,modifiedTime,trashed),nextPageToken,incompleteSearch'
      },
      headers: { Accept: 'application/json', Authorization: `Bearer ${this.getAccessToken(account)}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
    const records = this.assertBounded(response.data, config)
      .map(formRecord)
      .filter(Boolean)
      .filter(form => this.isWithinCursor(form, cursorDate, config));
    const newest = records.reduce((latest, form) => {
      const updated = new Date(form.updatedAt || form.createdAt || 0);
      return !Number.isNaN(updated.getTime()) && (!latest || updated > latest) ? updated : latest;
    }, cursorDate);
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'google_forms_metadata',
        forms: records.length,
        contentPolicy: 'bounded_google_forms_metadata_only_no_form_bodies_questions_responses_owners_urls_collaborators_sharing_details_shared_drives_or_provider_writes'
      }
    };
  }
}

const googleFormsWorkSignalClient = new GoogleFormsWorkSignalClient();
module.exports = googleFormsWorkSignalClient;
module.exports.GoogleFormsWorkSignalClient = GoogleFormsWorkSignalClient;
