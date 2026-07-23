const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://openapi.ravetree.com/v2/work-items';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const connectorError = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const safeId = value => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ''));
const parseDate = value => { if (value === undefined || value === null || value === '') return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const boundedText = value => {
  const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 160) : undefined;
};
const workItemRecord = item => {
  const id = String(item?.id || ''); const title = boundedText(item?.title);
  const startsAt = parseDate(item?.startsOn); const dueAt = parseDate(item?.dueOn); const completedAt = parseDate(item?.completedOn);
  const createdAt = parseDate(item?.created?.at); const updatedAt = parseDate(item?.updated?.at);
  if (!safeId(id) || !title || (item?.startsOn && !startsAt) || (item?.dueOn && !dueAt) || (item?.completedOn && !completedAt) || (item?.created?.at && !createdAt) || (item?.updated?.at && !updatedAt)) return null;
  return compact({ id: `work_item:${id}`, sourceType: 'work_item', workItemId: id, name: title, status: completedAt ? 'done' : 'open', startAt: startsAt?.toISOString(), dueAt: dueAt?.toISOString(), completedAt: completedAt?.toISOString(), createdAt: createdAt?.toISOString(), updatedAt: updatedAt?.toISOString() });
};

class RavetreeWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig() {
    return { timeout: clamp(process.env.SNEUP_RAVETREE_TIMEOUT_MS, 15000, 1000, 60000), maxWorkItems: clamp(process.env.SNEUP_RAVETREE_MAX_WORK_ITEMS, 500, 1, 5000), pageSize: clamp(process.env.SNEUP_RAVETREE_PAGE_SIZE, 100, 1, 100), maxPages: clamp(process.env.SNEUP_RAVETREE_MAX_PAGES, 20, 1, 100), maxResponseBytes: clamp(process.env.SNEUP_RAVETREE_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000), cursorLookbackMs: clamp(process.env.SNEUP_RAVETREE_CURSOR_LOOKBACK_MS, 60000, 0, 3600000) };
  }

  getToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = String(credentials.token || credentials.apiToken || credentials.accessToken || '').trim();
    if (!token) throw connectorError('Ravetree API token is missing. Reconnect this account to continue syncing.', 503);
    return token;
  }

  request(config, token, offset, limit) {
    return this.http.get(API_URL, { params: { offset, limit }, headers: { Accept: 'application/json', Authorization: token }, timeout: config.timeout, maxContentLength: config.maxResponseBytes, maxBodyLength: 64 * 1024, maxRedirects: 0, proxy: false });
  }

  validatePage(body, limit) {
    const records = body?.data;
    if (!Array.isArray(records) || records.length > limit) throw connectorError('Ravetree returned an invalid or over-limit work-item page. Reconnect this account before syncing again.');
    return records;
  }

  async fetchDelta(account, cursor) {
    const priorCursor = cursor ? parseDate(cursor) : null;
    if (cursor && !priorCursor) throw connectorError('Ravetree work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const config = this.getConfig(); const token = this.getToken(account); const cutoff = priorCursor ? new Date(priorCursor.getTime() - config.cursorLookbackMs) : null;
    const records = []; let offset = 0; let pages = 0; let scanned = 0;
    while (true) {
      if (pages >= config.maxPages) throw connectorError('Ravetree sync reached its configured page limit. Increase SNEUP_RAVETREE_MAX_PAGES before continuing.', 413);
      const remaining = config.maxWorkItems - scanned;
      if (remaining <= 0) throw connectorError('Ravetree sync reached its configured work-item limit. Increase SNEUP_RAVETREE_MAX_WORK_ITEMS before continuing.', 413);
      const limit = Math.min(config.pageSize, remaining);
      const sourceRecords = this.validatePage((await this.request(config, token, offset, limit))?.data, limit);
      const normalized = sourceRecords.map(workItemRecord);
      if (normalized.some(item => !item)) throw connectorError('Ravetree returned invalid work-item metadata. Reconnect this account before syncing again.');
      records.push(...normalized.filter(item => { const changed = parseDate(item.updatedAt || item.createdAt || item.completedAt); return !cutoff || !changed || changed >= cutoff; }));
      scanned += sourceRecords.length; pages += 1;
      if (sourceRecords.length < limit) break;
      if (scanned >= config.maxWorkItems) throw connectorError('Ravetree sync reached its configured work-item limit. Increase SNEUP_RAVETREE_MAX_WORK_ITEMS before continuing.', 413);
      offset += sourceRecords.length;
    }
    const newest = records.reduce((latest, item) => { const changed = parseDate(item.updatedAt || item.createdAt || item.completedAt); return changed && (!latest || changed > latest) ? changed : latest; }, priorCursor);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'ravetree_work_item_metadata', workItems: records.length, pages, contentPolicy: 'bounded_work_item_metadata_only_no_details_people_accounts_contacts_teams_dependencies_time_tags_custom_fields_urls_or_provider_writes' } };
  }
}

const ravetreeWorkSignalClient = new RavetreeWorkSignalClient();
module.exports = ravetreeWorkSignalClient;
module.exports.RavetreeWorkSignalClient = RavetreeWorkSignalClient;
