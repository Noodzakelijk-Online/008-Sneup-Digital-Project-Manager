const axios = require('axios');
const dns = require('dns');
const https = require('https');
const net = require('net');
const accountConnectorService = require('./accountConnectorService');

const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const parseDate = value => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const boundedText = value => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 160) : undefined;
};
const validId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const error = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });

const privateAddress = value => {
  const family = net.isIP(value);
  const address = String(value || '').toLowerCase();
  if (family === 4) {
    const octets = address.split('.').map(Number);
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127
      || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && (octets[1] === 0 || octets[1] === 168 || octets[1] === 2))
      || (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19 || octets[1] === 51))
      || (octets[0] === 203 && octets[1] === 0 && octets[2] === 113)
      || octets[0] >= 224;
  }
  if (family === 6) {
    if (address === '::' || address === '::1' || address.startsWith('fc') || address.startsWith('fd') || /^fe[89ab]/.test(address)) return true;
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return Boolean(mapped && privateAddress(mapped[1]));
  }
  return true;
};

const projectRecord = value => {
  const projectId = String(value?.id || '');
  const name = boundedText(value?.name);
  const createdAt = parseDate(value?.createdAt);
  const updatedAt = parseDate(value?.updatedAt);
  if (!validId(projectId) || !name || (value?.createdAt && !createdAt) || (value?.updatedAt && !updatedAt) || (value?.active !== undefined && typeof value.active !== 'boolean')) return null;
  return compact({ id: `project:${projectId}`, sourceType: 'project', projectId, name, identifier: boundedText(value.identifier), status: value.active === false ? 'archived' : 'open', createdAt: createdAt?.toISOString(), updatedAt: updatedAt?.toISOString() });
};

const projectIdFromHref = value => {
  const match = String(value || '').match(/^\/api\/v3\/(?:projects|workspaces)\/([1-9][0-9]{0,19})$/);
  return match ? match[1] : undefined;
};
const linkedTitle = value => boundedText(value?._links?.status?.title || value?._links?.priority?.title);
const workPackageStatus = value => {
  if (value?.percentageDone === 100) return 'done';
  const title = boundedText(value?._links?.status?.title);
  if (/\b(done|closed|resolved|complete|completed)\b/i.test(title || '')) return 'done';
  if (/\b(blocked|stuck|impediment)\b/i.test(title || '')) return 'blocked';
  if (/\b(waiting|pending|hold|review)\b/i.test(title || '')) return 'waiting';
  if (/\b(progress|started|active|doing)\b/i.test(title || '')) return 'in_progress';
  return 'open';
};
const workPackageRecord = value => {
  const workPackageId = String(value?.id || '');
  const name = boundedText(value?.subject);
  const startAt = parseDate(value?.startDate);
  const dueAt = parseDate(value?.dueDate);
  const createdAt = parseDate(value?.createdAt);
  const updatedAt = parseDate(value?.updatedAt);
  const percentageDone = value?.percentageDone;
  const projectId = projectIdFromHref(value?._links?.project?.href);
  if (!validId(workPackageId) || !name || (value?.startDate && !startAt) || (value?.dueDate && !dueAt) || (value?.createdAt && !createdAt) || (value?.updatedAt && !updatedAt) || (percentageDone !== undefined && (!Number.isInteger(percentageDone) || percentageDone < 0 || percentageDone > 100)) || (value?._links?.project?.href && !projectId)) return null;
  return compact({ id: `work_package:${workPackageId}`, sourceType: 'work_package', workPackageId, projectId, name, status: workPackageStatus(value), priority: linkedTitle({ _links: { priority: value?._links?.priority } }), startAt: startAt?.toISOString(), dueAt: dueAt?.toISOString(), createdAt: createdAt?.toISOString(), updatedAt: updatedAt?.toISOString(), percentageDone });
};

class OpenProjectWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
    this.resolve4 = options.resolve4 || dns.promises.resolve4;
    this.resolve6 = options.resolve6 || dns.promises.resolve6;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_OPENPROJECT_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clamp(process.env.SNEUP_OPENPROJECT_MAX_PROJECTS, 100, 1, 500),
      maxWorkPackages: clamp(process.env.SNEUP_OPENPROJECT_MAX_WORK_PACKAGES, 2500, 1, 10000),
      pageSize: clamp(process.env.SNEUP_OPENPROJECT_PAGE_SIZE, 100, 1, 100),
      maxResponseBytes: clamp(process.env.SNEUP_OPENPROJECT_MAX_RESPONSE_BYTES, 1000000, 1024, 5000000),
      cursorLookbackMs: clamp(process.env.SNEUP_OPENPROJECT_CURSOR_LOOKBACK_MS, 60000, 0, 24 * 60 * 60 * 1000)
    };
  }

  getTarget(account) {
    let target;
    try { target = new URL(String(account?.metadata?.fields?.baseUrl || '').trim()); } catch { target = null; }
    if (!target || target.protocol !== 'https:' || target.username || target.password || target.port || !['', '/'].includes(target.pathname) || target.search || target.hash) throw error('OpenProject requires a public HTTPS instance URL without a path, port, credentials, query, or fragment.', 400);
    return target;
  }

  getApiKey(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const apiKey = credentials.apiKey || credentials.token || credentials.accessToken;
    if (!apiKey) throw error('OpenProject API token is missing. Reconnect this account to continue syncing.', 503);
    return apiKey;
  }

  async resolvePublicAddresses(hostname) {
    if (net.isIP(hostname)) return privateAddress(hostname) ? [] : [{ address: hostname, family: net.isIP(hostname) }];
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) return [];
    const results = await Promise.allSettled([this.resolve4(hostname), this.resolve6(hostname)]);
    const addresses = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
      .map(address => ({ address, family: net.isIP(address) }))
      .filter(item => item.family);
    return addresses.length && addresses.every(item => !privateAddress(item.address)) ? addresses : [];
  }

  createRequestOptions(target, apiKey, addresses, config) {
    const lookup = (hostname, options, callback) => {
      const family = typeof options === 'number' ? options : options?.family || 0;
      const address = addresses.find(item => !family || item.family === family);
      if (!address || hostname !== target.hostname) return callback(Object.assign(new Error('OpenProject lookup rejected an unexpected host.'), { code: 'ENOTFOUND' }));
      return callback(null, address.address, address.family);
    };
    return {
      headers: { Accept: 'application/hal+json', Authorization: `Bearer ${apiKey}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: 64 * 1024,
      maxRedirects: 0,
      proxy: false,
      httpsAgent: new https.Agent({ keepAlive: false, lookup })
    };
  }

  async listCollection({ target, request, path, params, limit, label, transform }) {
    const records = [];
    const { pageSize, ...requestOptions } = request;
    let offset = 1;
    let pages = 0;
    while (true) {
      const remaining = limit - records.length;
      if (remaining <= 0) throw error(`OpenProject sync reached its configured ${label} limit. Increase the corresponding SNEUP_OPENPROJECT limit before continuing.`, 413);
      const response = await this.http.get(`${target.origin}${path}`, { ...requestOptions, params: { ...params, offset, pageSize: Math.min(pageSize, remaining) } });
      const data = response?.data;
      const values = data?._embedded?.elements;
      const total = Number(data?.total);
      const count = Number(data?.count);
      if (!data || !Array.isArray(values) || !Number.isInteger(total) || total < 0 || !Number.isInteger(count) || count < 0 || count !== values.length || values.length > remaining || values.length > pageSize) throw error('OpenProject returned an invalid or over-limit metadata page. Reconnect this account before syncing again.');
      if (total > limit) throw error(`OpenProject sync reached its configured ${label} limit. Increase the corresponding SNEUP_OPENPROJECT limit before continuing.`, 413);
      const normalized = values.map(transform);
      if (normalized.some(item => !item)) throw error('OpenProject returned invalid project or work-package metadata. Reconnect this account before syncing again.');
      records.push(...normalized);
      pages += 1;
      if (records.length === total) return { records, pages };
      if (records.length > total || values.length === 0) throw error('OpenProject returned an incomplete metadata page. Reconnect this account before syncing again.');
      offset += values.length;
    }
  }

  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) throw error('OpenProject work-signal cursor is invalid. Reconnect this account to establish a new cursor.', 400);
    const config = this.getConfig();
    const target = this.getTarget(account);
    const apiKey = this.getApiKey(account);
    const addresses = await this.resolvePublicAddresses(target.hostname);
    if (addresses.length === 0) throw error('OpenProject instance must resolve only to public network addresses.', 400);
    const request = { ...this.createRequestOptions(target, apiKey, addresses, config), pageSize: config.pageSize };
    const projects = await this.listCollection({ target, request, path: '/api/v3/projects', params: { select: 'total,count,elements/id,elements/name,elements/identifier,elements/active,elements/createdAt,elements/updatedAt' }, limit: config.maxProjects, label: 'project', transform: projectRecord });
    const workPackages = await this.listCollection({ target, request, path: '/api/v3/work_packages', params: { filters: '[]', select: 'total,count,elements/id,elements/subject,elements/startDate,elements/dueDate,elements/percentageDone,elements/createdAt,elements/updatedAt,elements/_links/project,elements/_links/status,elements/_links/priority' }, limit: config.maxWorkPackages, label: 'work-package', transform: workPackageRecord });
    const lookback = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs) : null;
    const records = [...projects.records, ...workPackages.records].filter(record => {
      const updatedAt = parseDate(record.updatedAt || record.createdAt);
      return !lookback || !updatedAt || updatedAt >= lookback;
    });
    const newest = records.reduce((latest, record) => {
      const updatedAt = parseDate(record.updatedAt || record.createdAt);
      return updatedAt && (!latest || updatedAt > latest) ? updatedAt : latest;
    }, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'openproject_project_work_package_metadata', projects: projects.records.length, workPackages: workPackages.records.length, pages: projects.pages + workPackages.pages, contentPolicy: 'bounded_project_and_work_package_metadata_only_no_descriptions_comments_attachments_people_custom_fields_urls_or_provider_writes' } };
  }
}

const openProjectWorkSignalClient = new OpenProjectWorkSignalClient();
module.exports = openProjectWorkSignalClient;
module.exports.OpenProjectWorkSignalClient = OpenProjectWorkSignalClient;
