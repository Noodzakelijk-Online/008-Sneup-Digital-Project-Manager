const axios = require('axios');
const dns = require('dns');
const https = require('https');
const net = require('net');
const accountConnectorService = require('./accountConnectorService');

const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const parseDate = value => { const parsed = new Date(value); return value && !Number.isNaN(parsed.getTime()) ? parsed : null; };
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const safeId = value => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ''));

const privateAddress = (value) => {
  const family = net.isIP(value); const address = String(value || '').toLowerCase();
  if (family === 4) { const octets = address.split('.').map(Number); return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && (octets[1] === 0 || octets[1] === 168 || octets[1] === 2)) || (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19 || octets[1] === 51)) || (octets[0] === 203 && octets[1] === 0 && octets[2] === 113) || octets[0] >= 224; }
  if (family === 6) { if (address === '::' || address === '::1' || address.startsWith('fc') || address.startsWith('fd') || /^fe[89ab]/.test(address)) return true; const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); return Boolean(mapped && privateAddress(mapped[1])); }
  return true;
};

const collectionFrom = (payload, label) => {
  const collection = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(collection)) { const error = new Error(`n8n ${label} response must contain a data array.`); error.statusCode = 502; throw error; }
  return collection;
};

const workflowRecord = item => {
  const workflowId = String(item?.id || ''); const name = boundedText(item?.name, 160);
  if (!safeId(workflowId) || !name) return null;
  return compact({ id: `workflow:${workflowId}`, sourceType: 'workflow', workflowId, name, active: Boolean(item.active), createdAt: item.createdAt, updatedAt: item.updatedAt });
};

const executionRecord = (item, activeWorkflowIds) => {
  const executionId = String(item?.id || ''); const workflowId = String(item?.workflowId || '');
  if (!safeId(executionId) || !safeId(workflowId) || !activeWorkflowIds.has(workflowId)) return null;
  const status = boundedText(item.status, 32);
  return compact({ id: `execution:${executionId}`, sourceType: 'execution', executionId, workflowId, name: boundedText(`Workflow execution ${workflowId}`, 160), status, finished: Boolean(item.finished), startedAt: item.startedAt, stoppedAt: item.stoppedAt });
};

class N8nWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; this.resolve4 = options.resolve4 || dns.promises.resolve4; this.resolve6 = options.resolve6 || dns.promises.resolve6; }

  getConfig() { return { timeout: clamp(process.env.SNEUP_N8N_TIMEOUT_MS, 15000, 1000, 60000), maxWorkflows: clamp(process.env.SNEUP_N8N_MAX_WORKFLOWS, 250, 1, 1000), maxExecutions: clamp(process.env.SNEUP_N8N_MAX_EXECUTIONS, 500, 1, 5000), maxResponseBytes: clamp(process.env.SNEUP_N8N_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000) }; }

  getToken(account) { const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.apiKey || credentials.token; if (!token) { const error = new Error('n8n API key is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; } return token; }

  getTarget(account) {
    let baseUrl;
    try { baseUrl = new URL(String(account?.metadata?.fields?.baseUrl || '').trim()); } catch { baseUrl = null; }
    if (!baseUrl || baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.port || baseUrl.search || baseUrl.hash || !['', '/'].includes(baseUrl.pathname)) { const error = new Error('n8n requires a public HTTPS instance URL without a path, port, credentials, query, or fragment.'); error.statusCode = 400; throw error; }
    return baseUrl;
  }

  async resolvePublicAddresses(hostname) {
    if (net.isIP(hostname)) return privateAddress(hostname) ? [] : [{ address: hostname, family: net.isIP(hostname) }];
    if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) return [];
    const results = await Promise.allSettled([this.resolve4(hostname), this.resolve6(hostname)]); const addresses = results.flatMap(result => result.status === 'fulfilled' ? result.value : []).map(address => ({ address, family: net.isIP(address) })).filter(item => item.family);
    return addresses.length && addresses.every(item => !privateAddress(item.address)) ? addresses : [];
  }

  createRequestOptions(target, token, addresses, config) {
    const lookup = (hostname, options, callback) => { const family = typeof options === 'number' ? options : options?.family || 0; const address = addresses.find(item => !family || item.family === family); if (!address || hostname !== target.hostname) return callback(Object.assign(new Error('n8n lookup rejected an unexpected host.'), { code: 'ENOTFOUND' })); return callback(null, address.address, address.family); };
    return { headers: { Accept: 'application/json', 'X-N8N-API-KEY': token, 'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)' }, timeout: config.timeout, maxContentLength: config.maxResponseBytes, maxBodyLength: config.maxResponseBytes, maxRedirects: 0, proxy: false, httpsAgent: new https.Agent({ keepAlive: false, lookup }) };
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig(); const token = this.getToken(account); const target = this.getTarget(account); const addresses = await this.resolvePublicAddresses(target.hostname);
    if (addresses.length === 0) { const error = new Error('n8n instance must resolve only to public network addresses.'); error.statusCode = 400; throw error; }
    const request = this.createRequestOptions(target, token, addresses, config); const apiBase = `${target.origin}/api/v1`;
    const [workflowsResponse, executionsResponse] = await Promise.all([
      this.http.get(`${apiBase}/workflows`, { ...request, params: { active: true, limit: config.maxWorkflows + 1 } }),
      this.http.get(`${apiBase}/executions`, { ...request, params: { includeData: false, limit: config.maxExecutions + 1 } })
    ]);
    const workflows = collectionFrom(workflowsResponse.data, 'workflows'); const executions = collectionFrom(executionsResponse.data, 'executions');
    if (workflows.length > config.maxWorkflows || executions.length > config.maxExecutions || workflowsResponse.data?.nextCursor || executionsResponse.data?.nextCursor) { const error = new Error('n8n sync reached its configured collection limit. Narrow the instance scope or increase the matching SNEUP_N8N_MAX_* limit before continuing.'); error.statusCode = 413; throw error; }
    const workflowRecords = workflows.map(workflowRecord).filter(Boolean); const activeWorkflowIds = new Set(workflowRecords.filter(item => item.active).map(item => item.workflowId)); const executionRecords = executions.map(item => executionRecord(item, activeWorkflowIds)).filter(Boolean);
    const cursorDate = parseDate(cursor); const newest = [...workflowRecords, ...executionRecords].reduce((latest, item) => { const updated = parseDate(item.stoppedAt || item.updatedAt || item.startedAt || item.createdAt); return updated && (!latest || updated > latest) ? updated : latest; }, cursorDate);
    return { records: [...workflowRecords, ...executionRecords], nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'n8n_api', workflows: workflowRecords.length, executions: executionRecords.length, contentPolicy: 'bounded_active_workflow_and_execution_metadata_only_no_workflow_definitions_credentials_execution_data_or_provider_writes' } };
  }
}

const n8nWorkSignalClient = new N8nWorkSignalClient();
module.exports = n8nWorkSignalClient;
module.exports.N8nWorkSignalClient = N8nWorkSignalClient;
