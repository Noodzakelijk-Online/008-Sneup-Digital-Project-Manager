const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const DEFAULT_API_URL = 'https://slack.com/api';
const DEFAULT_MAX_CHANNELS = 25;
const DEFAULT_MAX_MESSAGES_PER_CHANNEL = 15;
const DEFAULT_MAX_TOTAL_MESSAGES = 250;
const DEFAULT_CURSOR_LOOKBACK_MS = 60000;

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

const parseTimestamp = (value) => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
};

const parseCursor = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

class SlackWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      apiUrl: String(process.env.SNEUP_SLACK_API_URL || DEFAULT_API_URL).replace(/\/$/, ''),
      timeout: clampInteger(process.env.SNEUP_SLACK_TIMEOUT_MS, 15000, 1000, 60000),
      maxChannels: clampInteger(process.env.SNEUP_SLACK_MAX_CHANNELS, DEFAULT_MAX_CHANNELS, 1, 100),
      maxMessagesPerChannel: clampInteger(process.env.SNEUP_SLACK_MAX_MESSAGES_PER_CHANNEL, DEFAULT_MAX_MESSAGES_PER_CHANNEL, 1, 100),
      maxTotalMessages: clampInteger(process.env.SNEUP_SLACK_MAX_TOTAL_MESSAGES, DEFAULT_MAX_TOTAL_MESSAGES, 1, 5000),
      cursorLookbackMs: clampInteger(process.env.SNEUP_SLACK_CURSOR_LOOKBACK_MS, DEFAULT_CURSOR_LOOKBACK_MS, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('Slack access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  headers(token) {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    };
  }

  assertSlackResponse(response, operation) {
    if (response.data?.ok !== false) return response.data || {};
    const error = new Error(`Slack ${operation} failed: ${response.data.error || 'unknown_error'}`);
    error.statusCode = 502;
    throw error;
  }

  async getTeam(token, config) {
    const response = await this.http.post(`${config.apiUrl}/auth.test`, {}, {
      headers: this.headers(token),
      timeout: config.timeout
    });
    return this.assertSlackResponse(response, 'identity check');
  }

  async listChannels(token, config) {
    const channels = [];
    let cursor;
    do {
      const response = await this.http.get(`${config.apiUrl}/conversations.list`, {
        params: {
          limit: Math.min(100, config.maxChannels - channels.length),
          types: 'public_channel,private_channel',
          exclude_archived: true,
          ...(cursor ? { cursor } : {})
        },
        headers: this.headers(token),
        timeout: config.timeout
      });
      const data = this.assertSlackResponse(response, 'channel listing');
      channels.push(...(Array.isArray(data.channels) ? data.channels : []));
      cursor = String(data.response_metadata?.next_cursor || '').trim();
      if (channels.length >= config.maxChannels && cursor) {
        const error = new Error('Slack sync reached its configured channel limit. Increase SNEUP_SLACK_MAX_CHANNELS before continuing.');
        error.statusCode = 413;
        throw error;
      }
    } while (cursor);
    return channels;
  }

  messageUrl(team, channel, message) {
    const baseUrl = String(team.url || '').replace(/\/$/, '');
    const timestamp = String(message.ts || '').replace('.', '');
    return baseUrl && channel.id && timestamp ? `${baseUrl}/archives/${channel.id}/p${timestamp}` : undefined;
  }

  async listChannelMessages(channel, team, token, cursorDate, config) {
    const messages = [];
    let cursor;
    const oldest = cursorDate
      ? String((cursorDate.getTime() - config.cursorLookbackMs) / 1000)
      : undefined;
    do {
      // Slack documents conversations.history as a POST read query; this path never posts a message.
      const response = await this.http.post(`${config.apiUrl}/conversations.history`, {
        channel: channel.id,
        limit: Math.min(config.maxMessagesPerChannel, config.maxMessagesPerChannel - messages.length),
        ...(oldest ? { oldest } : {}),
        ...(cursor ? { cursor } : {})
      }, {
        headers: { ...this.headers(token), 'Content-Type': 'application/json' },
        timeout: config.timeout
      });
      const data = this.assertSlackResponse(response, 'channel history');
      const page = Array.isArray(data.messages) ? data.messages : [];
      messages.push(...page.map(message => ({
        ...message,
        url: this.messageUrl(team, channel, message),
        channel: { id: channel.id, name: channel.name, isPrivate: Boolean(channel.is_private) },
        team: { id: team.team_id, name: team.team, url: team.url }
      })));
      cursor = String(data.response_metadata?.next_cursor || '').trim();
      if (messages.length >= config.maxMessagesPerChannel && cursor) {
        const error = new Error(`Slack channel #${channel.name || channel.id} reached its configured message limit. Increase SNEUP_SLACK_MAX_MESSAGES_PER_CHANNEL before continuing.`);
        error.statusCode = 413;
        throw error;
      }
    } while (cursor);
    return messages;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const cursorDate = parseCursor(cursor);
    const team = await this.getTeam(token, config);
    const channels = await this.listChannels(token, config);
    const records = [];
    let newest = cursorDate;

    for (const channel of channels) {
      const messages = await this.listChannelMessages(channel, team, token, cursorDate, config);
      for (const message of messages) {
        if (records.length >= config.maxTotalMessages) {
          const error = new Error('Slack sync reached its configured total-message limit. Increase SNEUP_SLACK_MAX_TOTAL_MESSAGES before continuing.');
          error.statusCode = 413;
          throw error;
        }
        const createdAt = parseTimestamp(message.ts);
        if (createdAt && (!newest || createdAt > newest)) newest = createdAt;
        records.push(message);
      }
    }

    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: {
        source: 'slack_api',
        channels: channels.length,
        teamId: team.team_id || undefined
      }
    };
  }
}

const slackWorkSignalClient = new SlackWorkSignalClient();

module.exports = slackWorkSignalClient;
module.exports.SlackWorkSignalClient = SlackWorkSignalClient;
