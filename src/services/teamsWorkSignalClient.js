const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const GRAPH_URL = 'https://graph.microsoft.com/v1.0';
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const boundedText = (value, maximum = 160) => { const text = String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, maximum) : undefined; };
const teamId = value => /^[A-Fa-f0-9]{8}-[A-Fa-f0-9-]{27,64}$/.test(String(value || ''));
const channelId = value => /^[A-Za-z0-9:._@-]{1,255}$/.test(String(value || ''));
const parseDate = value => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };

const invalidResponse = message => { const error = new Error(message); error.statusCode = 502; return error; };

class TeamsWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }

  getConfig() { return { timeout: clamp(process.env.SNEUP_TEAMS_TIMEOUT_MS, 15000, 1000, 60000), maxTeams: clamp(process.env.SNEUP_TEAMS_MAX_TEAMS, 100, 1, 250), maxChannelsPerTeam: clamp(process.env.SNEUP_TEAMS_MAX_CHANNELS_PER_TEAM, 100, 1, 250), maxTotalChannels: clamp(process.env.SNEUP_TEAMS_MAX_TOTAL_CHANNELS, 1000, 1, 2500) }; }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token;
    if (!token) { const error = new Error('Microsoft Teams access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; }
    return token;
  }

  request(path, token, config, params = {}) {
    return this.http.get(`${GRAPH_URL}${path}`, { params, headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, timeout: config.timeout, maxRedirects: 0, proxy: false });
  }

  boundedCollection(response, limit, message) {
    const values = response?.data?.value;
    if (!Array.isArray(values) || values.length > limit) throw invalidResponse(message);
    if (values.length >= limit && response?.data?.['@odata.nextLink']) { const error = new Error(message); error.statusCode = 413; throw error; }
    return values;
  }

  normalizeTeam(item) {
    if (!teamId(item?.id)) throw invalidResponse('Microsoft Teams returned an invalid team identifier. Reconnect this account before syncing again.');
    return compact({ id: `team:${item.id}`, sourceType: 'team', teamId: item.id, name: boundedText(item.displayName) || 'Microsoft Team', status: item.isArchived ? 'archived' : 'open' });
  }

  normalizeChannel(item, team) {
    if (!channelId(item?.id)) throw invalidResponse('Microsoft Teams returned an invalid channel identifier. Reconnect this account before syncing again.');
    return compact({ id: `channel:${team.teamId}:${item.id}`, sourceType: 'channel', teamId: team.teamId, teamName: team.name, channelId: item.id, name: boundedText(item.displayName) || 'Microsoft Teams channel', membershipType: ['standard', 'private', 'shared'].includes(item.membershipType) ? item.membershipType : undefined, status: item.isArchived ? 'archived' : 'open', createdAt: parseDate(item.createdDateTime)?.toISOString() });
  }

  async fetchDelta(account, cursor) {
    const cursorDate = cursor ? parseDate(cursor) : null;
    if (cursor && !cursorDate) { const error = new Error('Microsoft Teams work-signal cursor is invalid. Reconnect this account to establish a new cursor.'); error.statusCode = 400; throw error; }
    const config = this.getConfig(); const token = this.getAccessToken(account);
    const teams = this.boundedCollection(await this.request('/me/joinedTeams', token, config), config.maxTeams, 'Microsoft Teams sync reached its configured team limit. Increase SNEUP_TEAMS_MAX_TEAMS before continuing.').map(item => this.normalizeTeam(item));
    const records = [...teams]; let channels = 0;
    for (const team of teams) {
      const values = this.boundedCollection(await this.request(`/teams/${encodeURIComponent(team.teamId)}/channels`, token, config, { '$top': config.maxChannelsPerTeam, '$select': 'id,displayName,membershipType,createdDateTime,isArchived' }), config.maxChannelsPerTeam, `Microsoft Teams channel sync reached its configured limit for ${team.name}. Increase SNEUP_TEAMS_MAX_CHANNELS_PER_TEAM before continuing.`);
      if (channels + values.length > config.maxTotalChannels) { const error = new Error('Microsoft Teams sync reached its configured total-channel limit. Increase SNEUP_TEAMS_MAX_TOTAL_CHANNELS before continuing.'); error.statusCode = 413; throw error; }
      channels += values.length;
      records.push(...values.map(item => this.normalizeChannel(item, team)));
    }
    return { records, nextCursor: cursorDate ? cursorDate.toISOString() : null, hasMore: false, metadata: { source: 'microsoft_teams_metadata', teams: teams.length, channels, contentPolicy: 'joined_team_and_basic_channel_metadata_only_no_messages_chats_meetings_files_tabs_members_descriptions_emails_or_provider_writes' } };
  }
}

const teamsWorkSignalClient = new TeamsWorkSignalClient();
module.exports = teamsWorkSignalClient;
module.exports.TeamsWorkSignalClient = TeamsWorkSignalClient;
