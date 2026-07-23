const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const DEFAULT_API_URL = 'https://api.airtable.com/v0';
const FIELD_LIMIT = 12;

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

const safeFields = (value) => String(value || '')
  .split(',')
  .map(field => field.trim())
  .filter(Boolean)
  .filter((field, index, fields) => fields.indexOf(field) === index);

const valueText = (value) => (Array.isArray(value) ? value.join(', ') : String(value ?? ''))
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
  .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 240);

const matchingField = (fields, pattern) => fields.find(field => pattern.test(field));
const connectorError = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const validRecordId = value => /^rec[A-Za-z0-9]{1,124}$/.test(String(value || ''));
const validOffset = value => typeof value === 'string' && value.length > 0 && value.length <= 512;

class AirtableWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig(account) {
    const metadata = account?.metadata?.fields || {};
    const allowedFields = safeFields(metadata.fieldNames);
    if (!metadata.baseId || !metadata.tableName || allowedFields.length === 0) {
      const error = new Error('Airtable base ID, table name, and allowed task fields are required before syncing.');
      error.statusCode = 400;
      throw error;
    }
    if (allowedFields.length > FIELD_LIMIT) {
      const error = new Error(`Airtable sync supports at most ${FIELD_LIMIT} allowed task fields.`);
      error.statusCode = 400;
      throw error;
    }
    return {
      apiUrl: this.getApiUrl(),
      baseId: String(metadata.baseId).trim(),
      tableName: String(metadata.tableName).trim(),
      allowedFields,
      timeout: clampInteger(process.env.SNEUP_AIRTABLE_TIMEOUT_MS, 15000, 1000, 60000),
      maxResponseBytes: clampInteger(process.env.SNEUP_AIRTABLE_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000),
      maxRecords: clampInteger(process.env.SNEUP_AIRTABLE_MAX_RECORDS, 1000, 1, 5000),
      pageSize: clampInteger(process.env.SNEUP_AIRTABLE_PAGE_SIZE, 100, 1, 100)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.accessToken || credentials.apiKey;
    if (!token) {
      const error = new Error('Airtable personal access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  getApiUrl() {
    const raw = String(process.env.SNEUP_AIRTABLE_API_URL || DEFAULT_API_URL).trim();
    let url;
    try {
      url = new URL(raw);
    } catch {
      const error = new Error('Airtable API URL must be https://api.airtable.com/v0.');
      error.statusCode = 400;
      throw error;
    }
    if (url.protocol !== 'https:' || url.hostname !== 'api.airtable.com' || url.pathname.replace(/\/$/, '') !== '/v0' || url.search || url.hash || url.username || url.password) {
      const error = new Error('Airtable API URL must be https://api.airtable.com/v0.');
      error.statusCode = 400;
      throw error;
    }
    return url.toString().replace(/\/$/, '');
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(account);
    const token = this.getAccessToken(account);
    const titleField = matchingField(config.allowedFields, /\b(name|title|task)\b/i) || config.allowedFields[0];
    const statusField = matchingField(config.allowedFields, /\b(status|state)\b/i);
    const priorityField = matchingField(config.allowedFields, /\bpriority\b/i);
    const ownerField = matchingField(config.allowedFields, /\b(owner|assigned|assignee|responsible)\b/i);
    const dueField = matchingField(config.allowedFields, /\b(due|deadline|finish|end)\b/i);
    const records = [];
    let offset;
    const seenOffsets = new Set();
    do {
      const remaining = config.maxRecords - records.length;
      if (remaining <= 0) {
        const error = new Error('Airtable sync reached its configured record limit. Increase SNEUP_AIRTABLE_MAX_RECORDS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      const response = await this.http.get(`${config.apiUrl}/${encodeURIComponent(config.baseId)}/${encodeURIComponent(config.tableName)}`, {
        params: { 'fields[]': config.allowedFields, pageSize: Math.min(config.pageSize, remaining), ...(offset ? { offset } : {}) },
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        timeout: config.timeout,
        maxContentLength: config.maxResponseBytes,
        maxBodyLength: config.maxResponseBytes,
        maxRedirects: 0,
        proxy: false
      });
      const page = response?.data?.records;
      if (!Array.isArray(page) || page.length > remaining) {
        throw connectorError('Airtable returned an invalid record page. Reconnect this account before syncing again.');
      }
      for (const record of page) {
        if (!record || typeof record !== 'object' || Array.isArray(record) || !validRecordId(record.id)
          || !record.fields || typeof record.fields !== 'object' || Array.isArray(record.fields)) {
          throw connectorError('Airtable returned invalid record metadata. Reconnect this account before syncing again.');
        }
        const fields = record.fields;
        const title = valueText(fields[titleField]);
        if (!title) continue;
        records.push({
          id: record.id,
          externalId: `base:${config.baseId}:table:${config.tableName}:record:${record.id}`,
          title,
          status: statusField ? valueText(fields[statusField]) : '',
          priority: priorityField ? valueText(fields[priorityField]) : '',
          owners: ownerField ? valueText(fields[ownerField]).split(/[;,]/).map(value => value.trim()).filter(Boolean) : [],
          dueAt: dueField ? valueText(fields[dueField]) : '',
          createdTime: record.createdTime,
          base: { id: config.baseId, name: config.baseId },
          table: { name: config.tableName }
        });
      }
      const nextOffset = response?.data?.offset;
      if (nextOffset !== undefined && nextOffset !== null && nextOffset !== '' && !validOffset(nextOffset)) {
        throw connectorError('Airtable returned an invalid pagination cursor. Reconnect this account before syncing again.');
      }
      if (nextOffset && seenOffsets.has(nextOffset)) {
        throw connectorError('Airtable returned a repeated pagination cursor. Reconnect this account before syncing again.');
      }
      if (nextOffset) seenOffsets.add(nextOffset);
      offset = nextOffset || undefined;
      if (offset && records.length >= config.maxRecords) {
        const error = new Error('Airtable sync reached its configured record limit. Increase SNEUP_AIRTABLE_MAX_RECORDS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      if (offset && page.length === 0) {
        const error = new Error('Airtable returned an incomplete record page. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
    } while (offset);
    return {
      records,
      nextCursor: cursor || null,
      hasMore: false,
      metadata: {
        source: 'airtable_api',
        projects: 1,
        items: records.length,
        contentPolicy: 'explicit_allowlisted_fields_only_with_redacted_values_no_unselected_fields_provider_urls_or_provider_writes'
      }
    };
  }
}

const airtableWorkSignalClient = new AirtableWorkSignalClient();
module.exports = airtableWorkSignalClient;
module.exports.AirtableWorkSignalClient = AirtableWorkSignalClient;
