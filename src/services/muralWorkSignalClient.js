const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');
const clamp = (value, fallback, minimum, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; };
const clean = value => String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]').replace(/\bhttps?:\/\/\S+/gi, '[redacted url]').replace(/\s+/g, ' ').trim().slice(0, 160);
const parseDate = value => { if (!value) return undefined; const date = new Date(value); return Number.isNaN(date.getTime()) ? undefined : date.toISOString(); };
class MuralWorkSignalClient {
  constructor(options = {}) { this.http = options.http || axios; this.accountConnectorService = options.accountConnectorService || accountConnectorService; }
  async fetchDelta(account, cursor) {
    const workspaceId = String(account?.metadata?.fields?.muralWorkspaceId || '');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)) { const error = new Error('Select one authorized Mural workspace before syncing.'); error.statusCode = 400; throw error; }
    const cursorDate = cursor ? new Date(cursor) : null; if (cursor && Number.isNaN(cursorDate.getTime())) { const error = new Error('Mural work-signal cursor is invalid.'); error.statusCode = 400; throw error; }
    const credentials = this.accountConnectorService.getAccountCredentials(account); const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) { const error = new Error('Mural access token is missing. Reconnect this account to continue syncing.'); error.statusCode = 503; throw error; }
    const maxMurals = clamp(process.env.SNEUP_MURAL_MAX_MURALS, 100, 1, 100); const timeout = clamp(process.env.SNEUP_MURAL_TIMEOUT_MS, 15000, 1000, 60000); const maxResponseBytes = clamp(process.env.SNEUP_MURAL_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000);
    const response = await this.http.get(`https://app.mural.co/api/public/v1/workspaces/${encodeURIComponent(workspaceId)}/murals`, { params: { status: 'active', sortBy: 'lastModified', limit: maxMurals }, headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, timeout, maxContentLength: maxResponseBytes, maxBodyLength: maxResponseBytes, maxRedirects: 0, proxy: false });
    const values = Array.isArray(response.data?.value) ? response.data.value : Array.isArray(response.data?.items) ? response.data.items : Array.isArray(response.data) ? response.data : null;
    if (!values) { const error = new Error('Mural returned an invalid active-mural collection.'); error.statusCode = 502; throw error; }
    if (values.length >= maxMurals || response.data?.next) { const error = new Error('Mural sync reached its configured active-mural limit.'); error.statusCode = 413; throw error; }
    const records = values.map(item => { const muralId = String(item?.id || ''); const name = clean(item?.title || item?.name); const updatedAt = parseDate(item?.updatedAt || item?.lastModified); if (!/^[A-Za-z0-9._-]{1,256}$/.test(muralId) || !name) return null; return { id: `mural:${muralId}`, sourceType: 'mural', muralId, workspaceId, name, status: 'open', createdAt: parseDate(item?.createdAt), updatedAt }; }).filter(Boolean).filter(item => !cursorDate || !item.updatedAt || new Date(item.updatedAt) >= cursorDate);
    const newest = records.reduce((latest, item) => item.updatedAt && (!latest || new Date(item.updatedAt) > latest) ? new Date(item.updatedAt) : latest, cursorDate);
    return { records, nextCursor: newest ? newest.toISOString() : cursor || null, hasMore: false, metadata: { source: 'mural_active_mural_metadata', workspaceSelected: true, murals: records.length, contentPolicy: 'one_selected_mural_workspace_active_mural_metadata_only_no_mural_content_widgets_comments_templates_rooms_people_urls_sharing_details_or_provider_writes' } };
  }
}
const muralWorkSignalClient = new MuralWorkSignalClient(); module.exports = muralWorkSignalClient; module.exports.MuralWorkSignalClient = MuralWorkSignalClient;
