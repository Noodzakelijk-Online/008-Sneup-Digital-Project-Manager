const crypto = require('crypto');
const axios = require('axios');
const mongoose = require('mongoose');
const ConnectorAccount = require('../models/ConnectorAccount');
const AuditEvent = require('../models/AuditEvent');
const { CATEGORIES, getCategories, getConnector, getConnectors } = require('./connectorRegistry');
const { buildConnectorSafetyProfile, summarizeConnectorSafety } = require('./connectorSafetyProfile');
const { getDefaultWorkspaceObjectId, normalizeWorkspaceObjectId } = require('./workspaceScopeService');

const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_CATALOG_LIMIT = 300;

const sanitizeText = (value) => String(value || '').trim().toLowerCase();
const normalizeText = (value) => sanitizeText(value).replace(/[^a-z0-9]+/g, '');

const CATEGORY_LOOKUP = (() => {
  const map = new Map();
  Object.entries(CATEGORIES).forEach(([id, name]) => {
    map.set(normalizeText(id), id);
    map.set(normalizeText(name), id);
  });
  return map;
})();

const clampPositiveInt = (value, defaultValue = 0, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, parsed));
};

class AccountConnectorService {
  constructor(options = {}) {
    this.http = options.http || axios;
  }

  async getJiraSites(accountId, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    this.requireJiraAccount(account);
    return this.fetchJiraSites(account);
  }

  async selectJiraSite(accountId, cloudId, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    this.requireJiraAccount(account);
    const requestedCloudId = String(cloudId || '').trim();
    if (!/^[A-Za-z0-9-]{8,100}$/.test(requestedCloudId)) {
      const error = new Error('A valid Jira cloud ID is required.');
      error.statusCode = 400;
      throw error;
    }

    const sites = await this.fetchJiraSites(account);
    const site = sites.find(item => item.cloudId === requestedCloudId);
    if (!site) {
      const error = new Error('That Jira site is no longer authorized for this account.');
      error.statusCode = 403;
      throw error;
    }

    account.metadata = {
      ...(account.metadata || {}),
      fields: {
        ...(account.metadata?.fields || {}),
        cloudId: site.cloudId
      }
    };
    account.status = 'connected';
    account.lastError = undefined;
    await account.save();
    return this.sanitizeAccount(account);
  }

  async getAsanaWorkspaces(accountId, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    this.requireAsanaAccount(account);
    return this.fetchAsanaWorkspaces(account);
  }

  async selectAsanaWorkspace(accountId, workspaceGid, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    this.requireAsanaAccount(account);
    const requestedWorkspaceGid = String(workspaceGid || '').trim();
    if (!/^[A-Za-z0-9_-]{5,100}$/.test(requestedWorkspaceGid)) {
      const error = new Error('A valid Asana workspace ID is required.');
      error.statusCode = 400;
      throw error;
    }

    const workspaces = await this.fetchAsanaWorkspaces(account);
    const workspace = workspaces.find(item => item.workspaceGid === requestedWorkspaceGid);
    if (!workspace) {
      const error = new Error('That Asana workspace is no longer authorized for this account.');
      error.statusCode = 403;
      throw error;
    }

    account.metadata = {
      ...(account.metadata || {}),
      fields: {
        ...(account.metadata?.fields || {}),
        asanaWorkspaceGid: workspace.workspaceGid
      }
    };
    account.status = 'connected';
    account.lastError = undefined;
    await account.save();
    return this.sanitizeAccount(account);
  }

  getCatalog(filters = {}) {
    const { category, search, limit, offset } = this.normalizeCatalogFilter(filters);
    const filteredConnectors = this.filterConnectors(category, search);
    const slicedConnectors = typeof limit === 'number' && limit > 0
      ? filteredConnectors.slice(offset || 0, (offset || 0) + limit)
      : filteredConnectors.slice(offset || 0);

    return {
      categories: getCategories(),
      connectors: slicedConnectors.map(connector => this.sanitizeConnector(connector)),
      safety: summarizeConnectorSafety(filteredConnectors),
      total: filteredConnectors.length,
      offset,
      limit
    };
  }

  normalizeCatalogFilter(filters = {}) {
    const category = this.normalizeCategory(filters.category);
    const search = filters.search || filters.query || '';
    const limit = clampPositiveInt(filters.limit, 0, 0, MAX_CATALOG_LIMIT);
    const offset = clampPositiveInt(filters.offset, 0, 0);
    return {
      category,
      search,
      limit,
      offset
    };
  }

  normalizeCategory(category) {
    if (!category || category === 'all') return undefined;
    const candidate = normalizeText(category);
    return candidate ? (CATEGORY_LOOKUP.get(candidate) || undefined) : undefined;
  }

  filterConnectors(category, search) {
    let connectors = getConnectors();

    if (category) {
      connectors = connectors.filter((connector) => connector.category === category);
    }

    if (search) {
      const normalizedSearch = String(search).trim().toLowerCase();
      if (normalizedSearch) {
        connectors = connectors.filter((connector) => {
          const name = String(connector.name || '').toLowerCase();
          const description = String(connector.description || '').toLowerCase();
          const categoryName = String(CATEGORIES[connector.category] || '').toLowerCase();
          return (
            name.includes(normalizedSearch) ||
            description.includes(normalizedSearch) ||
            categoryName.includes(normalizedSearch)
          );
        });
      }
    }

    return connectors;
  }

  getConnectorDetails(connectorId) {
    const connector = getConnector(connectorId);
    return connector ? this.sanitizeConnector(connector) : null;
  }

  async listAccounts(options = {}) {
    if (!this.isDatabaseReady()) {
      return [];
    }

    const accounts = await ConnectorAccount.find({ workspaceId: this.resolveWorkspaceId(options.workspaceId) })
      .sort({ category: 1, connectorName: 1, updatedAt: -1 });

    return accounts.map(account => this.sanitizeAccount(account));
  }

  beginConnection(connectorId, options = {}) {
    const connector = this.requireConnector(connectorId);
    const safety = buildConnectorSafetyProfile(connector);

    if (connector.auth.type !== 'oauth2') {
      if (safety.scopeReviewRequired && options.scopeAcknowledged !== true) {
        return {
          connector: this.sanitizeConnector(connector),
          authType: connector.auth.type,
          scopeReviewRequired: true,
          safety,
          message: 'Review the connector safety profile before entering provider credentials.'
        };
      }
      return {
        connector: this.sanitizeConnector(connector),
        authType: connector.auth.type,
        fields: connector.auth.fields || [],
        scopeAcknowledged: options.scopeAcknowledged === true,
        message: 'This connector uses a token, API key, webhook, or manual workspace link.'
      };
    }

    this.requireStateSecret();

    const config = this.getOAuthEnvironment(connector);
    const missing = [];
    if (!config.clientId) missing.push(`${config.envPrefix}_CLIENT_ID`);
    if (!config.clientSecret) missing.push(`${config.envPrefix}_CLIENT_SECRET`);

    if (missing.length > 0) {
      return {
        connector: this.sanitizeConnector(connector),
        authType: 'oauth2',
        missingConfig: missing,
        message: 'OAuth app credentials are required before Sneup can send users through this provider.'
      };
    }

    if (safety.scopeReviewRequired && options.scopeAcknowledged !== true) {
      return {
        connector: this.sanitizeConnector(connector),
        authType: 'oauth2',
        scopeReviewRequired: true,
        safety,
        message: 'Review the requested provider scopes before opening the authorization page.'
      };
    }

    const redirectUri = this.getRedirectUri(connector.id, options.baseUrl);
    const state = this.createState({
      connectorId: connector.id,
      returnTo: this.sanitizeReturnTo(options.returnTo),
      workspaceId: String(this.resolveWorkspaceId(options.workspaceId)),
      consent: this.createConsentEvidence(connector, options)
    });

    const authUrl = new URL(connector.auth.authorizationUrl);
    authUrl.searchParams.set('client_id', config.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    if (!connector.auth.omitResponseType) {
      authUrl.searchParams.set('response_type', 'code');
    }
    if (connector.auth.scopes && connector.auth.scopes.length > 0) {
      authUrl.searchParams.set('scope', connector.auth.scopes.join(' '));
    }
    if (connector.auth.audience) {
      authUrl.searchParams.set('audience', connector.auth.audience);
    }
    Object.entries(connector.auth.extraAuthParams || {}).forEach(([key, value]) => {
      authUrl.searchParams.set(key, value);
    });

    return {
      connector: this.sanitizeConnector(connector),
      authType: 'oauth2',
      authUrl: authUrl.toString(),
      redirectUri,
      stateExpiresInSeconds: STATE_TTL_MS / 1000
    };
  }

  async completeOAuth(connectorId, query, options = {}) {
    const connector = this.requireConnector(connectorId);
    if (connector.auth.type !== 'oauth2') {
      const error = new Error('OAuth connector not found');
      error.statusCode = 404;
      throw error;
    }

    this.requireDatabase();
    this.requireEncryptionKey();
    this.requireStateSecret();

    if (query.error) {
      const error = new Error(query.error_description || query.error);
      error.statusCode = 400;
      throw error;
    }

    const state = this.verifyState(query.state);
    if (state.connectorId !== connector.id) {
      const error = new Error('OAuth state does not match connector');
      error.statusCode = 400;
      throw error;
    }

    if (!query.code) {
      const error = new Error('OAuth callback did not include an authorization code');
      error.statusCode = 400;
      throw error;
    }

    const tokenResponse = await this.exchangeCodeForToken(connector, query.code, options.baseUrl);
    const account = await this.saveOAuthAccount(connector, tokenResponse, {
      workspaceId: state.workspaceId || options.workspaceId,
      consent: state.consent
    });

    return {
      account: this.sanitizeAccount(account),
      returnTo: state.returnTo || '/?connectors=1'
    };
  }

  async saveCredentialAccount(connectorId, body = {}, options = {}) {
    const connector = this.requireConnector(connectorId);
    const safety = buildConnectorSafetyProfile(connector);

    if (connector.auth.type === 'oauth2') {
      const error = new Error('Use the OAuth connect endpoint for this connector');
      error.statusCode = 400;
      throw error;
    }

    this.requireDatabase();
    this.requireEncryptionKey();
    if (safety.scopeReviewRequired && body.scopeAcknowledged !== true) {
      const error = new Error('Review and acknowledge the requested provider scopes before saving credentials');
      error.statusCode = 400;
      throw error;
    }

    const fields = connector.auth.fields || [];
    const missing = fields
      .filter(field => field.required && !body[field.name])
      .map(field => field.name);

    if (missing.length > 0) {
      const error = new Error(`Missing required fields: ${missing.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }

    const secretPayload = {};
    const metadataFields = {};
    for (const field of fields) {
      if (body[field.name] === undefined) continue;
      if (field.secret) {
        secretPayload[field.name] = body[field.name];
      } else {
        metadataFields[field.name] = body[field.name];
      }
    }

    const accountName = body.accountName || metadataFields.workspaceUrl || metadataFields.baseUrl || connector.name;
    const account = new ConnectorAccount({
      workspaceId: this.resolveWorkspaceId(options.workspaceId),
      connectorId: connector.id,
      connectorName: connector.name,
      category: connector.category,
      authType: connector.auth.type,
      status: 'connected',
      accountName,
      externalAccountId: body.externalAccountId || accountName,
      scopes: connector.auth.scopes || [],
      consent: this.createConsentEvidence(connector, {
        ...options,
        scopeAcknowledged: body.scopeAcknowledged === true
      }),
      credentials: {
        apiKey: Object.keys(secretPayload).length > 0 ? this.encrypt(JSON.stringify(secretPayload)) : undefined
      },
      metadata: {
        fields: metadataFields,
        sync: connector.sync || []
      },
      connectedBy: options.actorId || body.connectedBy || 'local-user',
      lastValidatedAt: new Date()
    });

    await account.save();
    await this.recordConnectionAudit(account, options.actorId);
    return this.sanitizeAccount(account);
  }

  async deleteAccount(accountId, options = {}) {
    this.requireDatabase();

    const account = await ConnectorAccount.findOne({
      _id: accountId,
      workspaceId: this.resolveWorkspaceId(options.workspaceId)
    });
    if (!account) {
      const error = new Error('Connector account not found');
      error.statusCode = 404;
      throw error;
    }

    await account.deleteOne();
    return { success: true };
  }

  async getManagedAccount(accountId, options = {}) {
    this.requireDatabase();
    const account = await ConnectorAccount.findOne({
      _id: accountId,
      workspaceId: this.resolveWorkspaceId(options.workspaceId)
    });
    if (!account) {
      const error = new Error('Connector account not found');
      error.statusCode = 404;
      throw error;
    }
    return account;
  }

  requireJiraAccount(account) {
    if (!['jira_software', 'jira_service_management'].includes(account.connectorId)) {
      const error = new Error('Jira site selection is only available for Jira connector accounts.');
      error.statusCode = 400;
      throw error;
    }
  }

  requireAsanaAccount(account) {
    if (account.connectorId !== 'asana') {
      const error = new Error('Asana workspace selection is only available for Asana connector accounts.');
      error.statusCode = 400;
      throw error;
    }
  }

  async fetchJiraSites(account) {
    const credentials = this.getAccountCredentials(account);
    const accessToken = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!accessToken) {
      const error = new Error('Jira access token is missing. Reconnect this account to continue.');
      error.statusCode = 503;
      throw error;
    }

    const apiUrl = String(process.env.SNEUP_JIRA_API_URL || 'https://api.atlassian.com').replace(/\/$/, '');
    const response = await this.http.get(`${apiUrl}/oauth/token/accessible-resources`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      timeout: 15000
    });

    return (Array.isArray(response.data) ? response.data : [])
      .filter(site => site?.id)
      .filter(site => (site.scopes || []).some(scope => String(scope).startsWith('read:jira') || scope === 'read:servicedesk-data'))
      .map(site => ({
        cloudId: site.id,
        name: String(site.name || site.url || site.id),
        url: site.url || undefined
      }));
  }

  async fetchAsanaWorkspaces(account) {
    const credentials = this.getAccountCredentials(account);
    const accessToken = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!accessToken) {
      const error = new Error('Asana access token is missing. Reconnect this account to continue.');
      error.statusCode = 503;
      throw error;
    }

    const apiUrl = String(process.env.SNEUP_ASANA_API_URL || 'https://app.asana.com/api/1.0').replace(/\/$/, '');
    const response = await this.http.get(`${apiUrl}/workspaces`, {
      params: { limit: 100, opt_fields: 'gid,name,is_organization' },
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      timeout: 15000
    });

    return (Array.isArray(response.data?.data) ? response.data.data : [])
      .filter(workspace => workspace?.gid || workspace?.id)
      .map(workspace => ({
        workspaceGid: String(workspace.gid || workspace.id),
        name: String(workspace.name || workspace.gid || workspace.id),
        organization: Boolean(workspace.is_organization)
      }));
  }

  async markAccountValidated(accountId, options = {}) {
    this.requireDatabase();

    const account = await ConnectorAccount.findOne({
      _id: accountId,
      workspaceId: this.resolveWorkspaceId(options.workspaceId)
    });
    if (!account) {
      const error = new Error('Connector account not found');
      error.statusCode = 404;
      throw error;
    }

    await account.markValidated({ validationMode: 'local-smoke-test' });
    return this.sanitizeAccount(account);
  }

  async exchangeCodeForToken(connector, code, baseUrl) {
    const config = this.getOAuthEnvironment(connector);
    const redirectUri = this.getRedirectUri(connector.id, baseUrl);
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', redirectUri);
    body.set('client_id', config.clientId);

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    if (connector.auth.tokenAuth === 'basic') {
      const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
      headers.Authorization = `Basic ${credentials}`;
    } else {
      body.set('client_secret', config.clientSecret);
    }

    const response = await axios.post(connector.auth.tokenUrl, body.toString(), {
      headers,
      timeout: 15000
    });

    return response.data;
  }

  async saveOAuthAccount(connector, tokenResponse, options = {}) {
    const accessToken = tokenResponse.access_token || tokenResponse.accessToken;
    const refreshToken = tokenResponse.refresh_token || tokenResponse.refreshToken;
    const expiresIn = tokenResponse.expires_in || tokenResponse.expiresIn;
    const expiresAt = expiresIn
      ? new Date(Date.now() + Number(expiresIn) * 1000)
      : undefined;

    const accountName =
      tokenResponse.team_name ||
      tokenResponse.workspace_name ||
      tokenResponse.enterprise_name ||
      tokenResponse.account_name ||
      tokenResponse.authed_user?.id ||
      tokenResponse.team?.name ||
      connector.name;

    const externalAccountId =
      tokenResponse.team_id ||
      tokenResponse.workspace_id ||
      tokenResponse.enterprise_id ||
      tokenResponse.account_id ||
      tokenResponse.authed_user?.id ||
      tokenResponse.team?.id ||
      accountName;

    const account = new ConnectorAccount({
      workspaceId: this.resolveWorkspaceId(options.workspaceId),
      connectorId: connector.id,
      connectorName: connector.name,
      category: connector.category,
      authType: 'oauth2',
      status: 'connected',
      accountName,
      externalAccountId,
      scopes: this.normalizeScopes(tokenResponse.scope || connector.auth.scopes || []),
      consent: options.consent || this.createConsentEvidence(connector, options),
      credentials: {
        accessToken: accessToken ? this.encrypt(accessToken) : undefined,
        refreshToken: refreshToken ? this.encrypt(refreshToken) : undefined,
        tokenType: tokenResponse.token_type || 'Bearer',
        expiresAt
      },
      metadata: {
        providerResponseKeys: Object.keys(tokenResponse || {}),
        sync: connector.sync || []
      },
      lastValidatedAt: new Date()
    });

    await account.save();
    await this.recordConnectionAudit(account, options.consent?.acknowledgedBy);
    return account;
  }

  createConsentEvidence(connector, options = {}) {
    const safety = buildConnectorSafetyProfile(connector);
    const acknowledgedAt = options.consent?.acknowledgedAt || new Date().toISOString();
    const acknowledgedBy = options.consent?.acknowledgedBy || options.actorId || 'local-user';
    return {
      version: 'scope-review-v1',
      acknowledgedAt,
      acknowledgedBy,
      requestedScopes: this.normalizeScopes(safety.requestedScopes || connector.auth.scopes || []),
      scopeReviewRequired: Boolean(safety.scopeReviewRequired)
    };
  }

  async recordConnectionAudit(account, actor) {
    try {
      await AuditEvent.create({
        workspaceId: account.workspaceId,
        entityType: 'connector_account',
        entityId: account._id,
        action: 'connector_account_connected',
        actor: actor || account.connectedBy || 'local-user',
        source: 'api',
        riskLevel: account.consent?.scopeReviewRequired ? 'medium' : 'low',
        afterState: {
          connectorId: account.connectorId,
          connectorName: account.connectorName,
          authType: account.authType,
          scopes: account.scopes || [],
          consent: this.sanitizeConsent(account.consent)
        }
      });
    } catch (error) {
      await account.deleteOne?.();
      const auditError = new Error('Connector account was not linked because consent evidence could not be recorded');
      auditError.statusCode = 503;
      throw auditError;
    }
  }

  sanitizeConnector(connector) {
    return {
      id: connector.id,
      name: connector.name,
      category: connector.category,
      categoryName: CATEGORIES[connector.category],
      description: connector.description,
      auth: {
        type: connector.auth.type,
        docsUrl: connector.auth.docsUrl,
        scopes: connector.auth.scopes || [],
        fields: connector.auth.fields || [],
        configured: connector.auth.type !== 'oauth2' || this.hasOAuthEnvironment(connector)
      },
      safety: buildConnectorSafetyProfile(connector),
      sync: connector.sync || []
    };
  }

  sanitizeAccount(account) {
    return {
      id: account._id,
      workspaceId: account.workspaceId,
      connectorId: account.connectorId,
      connectorName: account.connectorName,
      category: account.category,
      categoryName: CATEGORIES[account.category],
      authType: account.authType,
      status: account.status,
      accountName: account.accountName,
      externalAccountId: account.externalAccountId,
      scopes: account.scopes || [],
      consent: this.sanitizeConsent(account.consent),
      metadata: this.sanitizeAccountMetadata(account.metadata),
      lastValidatedAt: account.lastValidatedAt,
      lastSyncAt: account.lastSyncAt,
      lastError: account.lastError,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    };
  }

  sanitizeAccountMetadata(metadata = {}) {
    const lastSync = metadata?.lastWorkSignalSync || {};
    return {
      fields: metadata?.fields || {},
      sync: Array.isArray(metadata?.sync) ? metadata.sync : [],
      workSignalAdapter: metadata?.workSignalAdapter,
      lastWorkSignalSync: Object.keys(lastSync).length > 0 ? {
        signalCount: Number(lastSync.signalCount || 0),
        hasMore: Boolean(lastSync.hasMore),
        retryCount: Number(lastSync.retryCount || 0),
        rateLimitWaitMs: Number(lastSync.rateLimitWaitMs || 0),
        attemptCount: Number(lastSync.attemptCount || 0),
        source: lastSync.source || undefined,
        repositories: Number(lastSync.repositories || 0),
        boards: Number(lastSync.boards || 0),
        sites: Number(lastSync.sites || 0),
        workspaces: Number(lastSync.workspaces || 0),
        projects: Number(lastSync.projects || 0),
        channels: Number(lastSync.channels || 0),
        finishedAt: lastSync.finishedAt
      } : undefined
    };
  }

  sanitizeConsent(consent = {}) {
    return {
      version: consent?.version || 'scope-review-v1',
      acknowledgedAt: consent?.acknowledgedAt || null,
      acknowledgedBy: consent?.acknowledgedBy || null,
      requestedScopes: this.normalizeScopes(consent?.requestedScopes || []),
      scopeReviewRequired: Boolean(consent?.scopeReviewRequired)
    };
  }

  getAccountCredentials(account) {
    const credentials = account?.credentials || {};
    const result = {};

    if (credentials.accessToken) result.accessToken = this.decrypt(credentials.accessToken);
    if (credentials.refreshToken) result.refreshToken = this.decrypt(credentials.refreshToken);
    if (credentials.apiKey) {
      const decrypted = this.decrypt(credentials.apiKey);
      try {
        Object.assign(result, JSON.parse(decrypted));
      } catch (error) {
        result.apiKey = decrypted;
      }
    }

    return result;
  }

  resolveWorkspaceId(workspaceId) {
    return normalizeWorkspaceObjectId(workspaceId || getDefaultWorkspaceObjectId());
  }

  requireConnector(connectorId) {
    const connector = getConnector(connectorId);
    if (!connector) {
      const error = new Error('Connector not found');
      error.statusCode = 404;
      throw error;
    }
    return connector;
  }

  getOAuthEnvironment(connector) {
    const envPrefix = connector.auth.envPrefix || connector.id.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    return {
      envPrefix,
      clientId: process.env[`${envPrefix}_CLIENT_ID`],
      clientSecret: process.env[`${envPrefix}_CLIENT_SECRET`]
    };
  }

  hasOAuthEnvironment(connector) {
    const config = this.getOAuthEnvironment(connector);
    return Boolean(config.clientId && config.clientSecret);
  }

  getRedirectUri(connectorId, baseUrl) {
    const configuredBaseUrl = process.env.SNEUP_PUBLIC_URL || process.env.APP_BASE_URL;
    const requestHostAllowed = process.env.SNEUP_TRUST_REQUEST_HOST === 'true';
    const fallbackBaseUrl = `http://127.0.0.1:${process.env.PORT || 3000}`;
    const appBaseUrl = (configuredBaseUrl || (requestHostAllowed ? baseUrl : fallbackBaseUrl)).replace(/\/$/, '');
    return `${appBaseUrl}/api/connectors/${connectorId}/callback`;
  }

  sanitizeReturnTo(returnTo) {
    if (typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
      return returnTo;
    }
    return '/?connectors=1';
  }

  createState(payload) {
    const statePayload = {
      ...payload,
      exp: Date.now() + STATE_TTL_MS,
      nonce: crypto.randomBytes(16).toString('hex')
    };
    const encoded = Buffer.from(JSON.stringify(statePayload)).toString('base64url');
    const signature = this.sign(encoded);
    return `${encoded}.${signature}`;
  }

  verifyState(state) {
    if (!state || !state.includes('.')) {
      const error = new Error('Missing or invalid OAuth state');
      error.statusCode = 400;
      throw error;
    }

    const [encoded, signature] = state.split('.');
    const expected = this.sign(encoded);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      const error = new Error('OAuth state signature is invalid');
      error.statusCode = 400;
      throw error;
    }

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) {
      const error = new Error('OAuth state expired');
      error.statusCode = 400;
      throw error;
    }

    return payload;
  }

  sign(value) {
    return crypto
      .createHmac('sha256', this.getStateSecret())
      .update(value)
      .digest('base64url');
  }

  encrypt(value) {
    if (value === undefined || value === null) return undefined;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.getEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  decrypt(value) {
    try {
      const [encodedIv, encodedTag, encodedPayload] = String(value || '').split('.');
      if (!encodedIv || !encodedTag || !encodedPayload) throw new Error('Invalid encrypted payload');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.getEncryptionKey(), Buffer.from(encodedIv, 'base64url'));
      decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encodedPayload, 'base64url')),
        decipher.final()
      ]).toString('utf8');
    } catch (error) {
      const credentialError = new Error('Connector credentials could not be decrypted. Reconnect this account to continue syncing.');
      credentialError.statusCode = 503;
      throw credentialError;
    }
  }

  getEncryptionKey() {
    const secret = process.env.CONNECTOR_ENCRYPTION_KEY;
    if (!secret || secret.length < 32) {
      const error = new Error('CONNECTOR_ENCRYPTION_KEY must be set to at least 32 characters before storing connector credentials');
      error.statusCode = 503;
      throw error;
    }

    return crypto.createHash('sha256').update(secret).digest();
  }

  getStateSecret() {
    const secret = process.env.CONNECTOR_STATE_SECRET;
    if (!secret || secret.length < 32) {
      const error = new Error('CONNECTOR_STATE_SECRET must be set to at least 32 characters before starting OAuth flows');
      error.statusCode = 503;
      throw error;
    }
    return secret;
  }

  requireEncryptionKey() {
    this.getEncryptionKey();
  }

  requireStateSecret() {
    this.getStateSecret();
  }

  requireDatabase() {
    if (!this.isDatabaseReady()) {
      const error = new Error('Database connection is required to save linked accounts');
      error.statusCode = 503;
      throw error;
    }
  }

  normalizeScopes(scopes) {
    if (Array.isArray(scopes)) return scopes;
    if (typeof scopes === 'string') return scopes.split(/[,\s]+/).filter(Boolean);
    return [];
  }

  isDatabaseReady() {
    return mongoose.connection.readyState === 1;
  }
}

module.exports = new AccountConnectorService();
