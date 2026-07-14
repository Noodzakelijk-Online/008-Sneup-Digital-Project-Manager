const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_URL = 'https://api.atlassian.com';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const validCloudId = value => /^[A-Za-z0-9-]{8,100}$/.test(String(value || ''));
const validContentId = value => /^\d{1,24}$/.test(String(value || ''));
const parseDate = value => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const invalidResponse = message => { const error = new Error(message); error.statusCode = 502; return error; };

const safeStatus = value => value === 'archived' ? 'archived' : 'current';
const safeSpaceType = value => ['global', 'personal', 'collaboration', 'knowledge_base'].includes(value) ? value : undefined;
const space = item => validContentId(item?.id) ? compact({ id: `space:${item.id}`, sourceType: 'space', spaceId: String(item.id), name: boundedText(item.name) || `Confluence space ${item.id}`, status: safeStatus(item.status), spaceType: safeSpaceType(item.type) }) : null;
const page = item => {
  const createdAt = parseDate(item?.createdAt);
  const updatedAt = parseDate(item?.version?.createdAt);
  if (!validContentId(item?.id) || !validContentId(item?.spaceId) || (item?.createdAt && !createdAt) || (item?.version?.createdAt && !updatedAt)) return null;
  return compact({ id: `page:${item.id}`, sourceType: 'page', pageId: String(item.id), spaceId: String(item.spaceId), parentPageId: validContentId(item?.parentId) ? String(item.parentId) : undefined, name: boundedText(item.title) || `Confluence page ${item.id}`, status: safeStatus(item.status), createdAt: createdAt?.toISOString(), updatedAt: updatedAt?.toISOString() });
};

class ConfluenceWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }
  getConfig() { return { timeout: clamp(process.env.SNEUP_CONFLUENCE_TIMEOUT_MS, 15000, 1000, 60000), maxSpaces: clamp(process.env.SNEUP_CONFLUENCE_MAX_SPACES, 250, 1, 1000), maxPages: clamp(process.env.SNEUP_CONFLUENCE_MAX_PAGES, 5000, 1, 10000), pageSize: clamp(process.env.SNEUP_CONFLUENCE_PAGE_SIZE, 100, 1, 250) }; }
  getAccessToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.accessToken || credentials.token; if (!token) { const error = new Error('Confluence OAuth access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }
  getCloudId(account) { const cloudId = String(account?.metadata?.fields?.confluenceCloudId || '').trim(); if (!validCloudId(cloudId)) { const error = new Error('Select an authorized Confluence site before syncing this account.'); error.statusCode = 409; throw error; } return cloudId; }
  getEndpoint(cloudId, path) { return `${API_URL}/ex/confluence/${encodeURIComponent(cloudId)}/wiki/api/v2${path}`; }
  request(cloudId, path, token, params, config) { return this.http.get(this.getEndpoint(cloudId, path), { params, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxRedirects: 0, proxy: false }); }
  cursorFromNext(next) { if (!next) return null; if (typeof next !== 'string' || next.length > 4096) throw invalidResponse('Confluence returned an invalid pagination cursor. Reconnect this account before syncing again.'); const cursor = new URL(next, 'https://pagination.invalid').searchParams.get('cursor'); if (!cursor || cursor.length > 2048 || /[\r\n]/.test(cursor)) throw invalidResponse('Confluence returned an invalid pagination cursor. Reconnect this account before syncing again.'); return cursor; }
  async fetchCollection(cloudId, path, token, maximum, config) {
    const records = []; let cursor;
    do {
      const remaining = maximum - records.length;
      const response = await this.request(cloudId, path, token, { limit: Math.min(config.pageSize, remaining), ...(cursor ? { cursor } : {}) }, config);
      const values = response?.data?.results;
      if (!Array.isArray(values)) throw invalidResponse('Confluence returned an invalid metadata collection. Reconnect this account before syncing again.');
      if (values.length > remaining) { const error = new Error('Confluence sync reached its configured collection limit. Increase the corresponding SNEUP_CONFLUENCE_MAX setting before continuing.'); error.statusCode = 413; throw error; }
      records.push(...values);
      cursor = this.cursorFromNext(response?.data?._links?.next);
      if (records.length >= maximum && cursor) { const error = new Error('Confluence sync reached its configured collection limit. Increase the corresponding SNEUP_CONFLUENCE_MAX setting before continuing.'); error.statusCode = 413; throw error; }
    } while (cursor);
    return records;
  }
  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) { const error = new Error('Confluence work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const config = this.getConfig(); const token = this.getAccessToken(account); const cloudId = this.getCloudId(account);
    const [spaces, pages] = await Promise.all([
      this.fetchCollection(cloudId, '/spaces', token, config.maxSpaces, config),
      this.fetchCollection(cloudId, '/pages', token, config.maxPages, config)
    ]);
    const normalizedSpaces = spaces.map(space).filter(Boolean); const normalizedPages = pages.map(page).filter(Boolean);
    if (normalizedSpaces.length !== spaces.length || normalizedPages.length !== pages.length) throw invalidResponse('Confluence returned an invalid page or space identifier. Reconnect this account before syncing again.');
    const spaceNames = new Map(normalizedSpaces.map(item => [item.spaceId, item.name]));
    normalizedPages.forEach(item => { item.spaceName = spaceNames.get(item.spaceId); });
    let newest = cursorDate; normalizedPages.forEach(item => { const updatedAt = parseDate(item.updatedAt || item.createdAt); if (updatedAt && (!newest || updatedAt > newest)) newest = updatedAt; });
    const records = [...normalizedSpaces, ...normalizedPages.filter(item => { const updatedAt = parseDate(item.updatedAt || item.createdAt); return !cursorDate || !updatedAt || updatedAt >= cursorDate; })];
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'confluence_page_space_metadata', cloudId, spaces: normalizedSpaces.length, pages: normalizedPages.length, contentPolicy: 'space_and_page_metadata_only_no_page_bodies_comments_attachments_users_descriptions_urls_version_messages_or_provider_writes' } };
  }
}

const confluenceWorkSignalClient = new ConfluenceWorkSignalClient();
module.exports = confluenceWorkSignalClient;
module.exports.ConfluenceWorkSignalClient = ConfluenceWorkSignalClient;
