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

const validTicketId = value => /^[1-9][0-9]{0,19}$/.test(String(value || ''));
const validCursor = value => /^[A-Za-z0-9._~%+=|:-]{1,1024}$/.test(String(value || ''));
const ticketStatus = value => ['new', 'open', 'pending', 'hold', 'solved', 'closed'].includes(value) ? value : undefined;
const ticketPriority = value => ['low', 'normal', 'high', 'urgent'].includes(value) ? value : undefined;
const ticketType = value => ['problem', 'incident', 'question', 'task'].includes(value) ? value : undefined;

const ticket = (item, apiUrl) => {
  if (!validTicketId(item?.id) || !item.subject) return null;
  const problemId = validTicketId(item.problem_id) ? String(item.problem_id) : undefined;
  return compact({
    id: `ticket:${item.id}`,
    sourceType: 'ticket',
    ticketId: String(item.id),
    name: boundedText(item.subject, 160),
    status: ticketStatus(item.status),
    priority: ticketPriority(item.priority),
    ticketType: ticketType(item.type),
    groupId: validTicketId(item.group_id) ? String(item.group_id) : undefined,
    problemId,
    blockedBy: problemId ? [{ externalId: `ticket:${problemId}`, relationship: 'blocked_by' }] : undefined,
    dueAt: item.due_at,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    url: `${apiUrl}/agent/tickets/${item.id}`
  });
};

class ZendeskWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
    this.now = options.now || (() => new Date());
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_ZENDESK_TIMEOUT_MS, 15000, 1000, 60000),
      maxTickets: clamp(process.env.SNEUP_ZENDESK_MAX_TICKETS, 2500, 1, 10000),
      pageSize: clamp(process.env.SNEUP_ZENDESK_PAGE_SIZE, 100, 1, 1000),
      initialLookbackDays: clamp(process.env.SNEUP_ZENDESK_INITIAL_LOOKBACK_DAYS, 30, 1, 90)
    };
  }

  getApiUrl(account) {
    const subdomain = String(account?.metadata?.fields?.subdomain || '').trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
      const error = new Error('Zendesk subdomain must use lowercase letters, numbers, and hyphens only.');
      error.statusCode = 400;
      throw error;
    }
    return `https://${subdomain}.zendesk.com`;
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const accessToken = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!accessToken) {
      const error = new Error('Zendesk OAuth access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return accessToken;
  }

  request(apiUrl, accessToken, config, params) {
    return this.http.get(`${apiUrl}/api/v2/incremental/tickets/cursor`, {
      params,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'Sneup Digital Project Manager (support@noodzakelijk.online)'
      },
      timeout: config.timeout,
      maxRedirects: 0,
      proxy: false
    });
  }

  initialStartTime(config) {
    return Math.floor((this.now().getTime() - config.initialLookbackDays * 24 * 60 * 60 * 1000) / 1000);
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const apiUrl = this.getApiUrl(account);
    const accessToken = this.getAccessToken(account);
    let providerCursor = cursor || null;
    if (providerCursor && !validCursor(providerCursor)) {
      const error = new Error('Zendesk returned an invalid incremental cursor. Reconnect this account to establish a new cursor.');
      error.statusCode = 400;
      throw error;
    }

    const records = [];
    let pageCount = 0;
    let fetchedTickets = 0;
    while (true) {
      const remaining = config.maxTickets - fetchedTickets;
      if (remaining <= 0) {
        const error = new Error('Zendesk sync reached its configured ticket limit. Increase SNEUP_ZENDESK_MAX_TICKETS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      const response = await this.request(apiUrl, accessToken, config, providerCursor
        ? { cursor: providerCursor, per_page: Math.min(config.pageSize, remaining), exclude_deleted: true }
        : { start_time: this.initialStartTime(config), per_page: Math.min(config.pageSize, remaining), exclude_deleted: true });
      const body = response.data || {};
      const page = body.tickets;
      const next = body.after_cursor;
      const endOfStream = body.end_of_stream;
      if (!Array.isArray(page) || page.length > remaining || typeof endOfStream !== 'boolean' || !validCursor(next)) {
        const error = new Error('Zendesk returned an invalid incremental ticket page. Reconnect this account before syncing again.');
        error.statusCode = 502;
        throw error;
      }
      records.push(...page.map(item => ticket(item, apiUrl)).filter(Boolean));
      fetchedTickets += page.length;
      pageCount += 1;
      if (endOfStream) {
        return {
          records,
          nextCursor: next,
          hasMore: false,
          metadata: {
            source: 'zendesk_incremental_ticket_export',
            tickets: records.length,
            pages: pageCount,
            contentPolicy: 'ticket_metadata_only_no_descriptions_comments_requesters_assignees_collaborators_tags_custom_fields_organizations_slas_or_provider_writes'
          }
        };
      }
      if (page.length === 0 || fetchedTickets >= config.maxTickets) {
        const error = new Error('Zendesk sync reached its configured ticket limit before the incremental stream completed. Increase SNEUP_ZENDESK_MAX_TICKETS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      providerCursor = next;
    }
  }
}

const zendeskWorkSignalClient = new ZendeskWorkSignalClient();
module.exports = zendeskWorkSignalClient;
module.exports.ZendeskWorkSignalClient = ZendeskWorkSignalClient;
