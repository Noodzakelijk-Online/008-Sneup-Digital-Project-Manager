const crypto = require('crypto');
const axios = require('axios');
const mongoose = require('mongoose');
const ConnectorAccount = require('../models/ConnectorAccount');
const { CATEGORIES, getCategories, getConnector, getConnectors } = require('./connectorRegistry');
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
  getCatalog(filters = {}) {
    const { category, search, limit, offset } = this.normalizeCatalogFilter(filters);
    const filteredConnectors = this.filterConnectors(category, search);
    const slicedConnectors = typeof limit === 'number' && limit > 0
      ? filteredConnectors.slice(offset || 0, (offset || 0) + limit)
      : filteredConnectors.slice(offset || 0);

    return {
      categories: getCategories(),
      connectors: slicedConnectors.map(connector => this.sanitizeConnector(connector)),
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

    if (connector.auth.type !== 'oauth2') {
      return {
        connector: this.sanitizeConnector(connector),
        authType: connector.auth.type,
        fields: connector.auth.fields || [],
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

    const redirectUri = this.getRedirectUri(connector.id, options.baseUrl);
    const state = this.createState({
      connectorId: connector.id,
      returnTo: this.sanitizeReturnTo(options.returnTo),
      workspaceId: String(this.resolveWorkspaceId(options.workspaceId))
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
      workspaceId: state.workspaceId || options.workspaceId
    });

    return {
      account: this.sanitizeAccount(account),
      returnTo: state.returnTo || '/?connectors=1'
    };
  }

  async saveCredentialAccount(connectorId, body = {}, options = {}) {
    const connector = this.requireConnector(connectorId);

    if (connector.auth.type === 'oauth2') {
      const error = new Error('Use the OAuth connect endpoint for this connector');
      error.statusCode = 400;
      throw error;
    }

    this.requireDatabase();
    this.requireEncryptionKey();

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
    return account;
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
      metadata: account.metadata || {},
      lastValidatedAt: account.lastValidatedAt,
      lastSyncAt: account.lastSyncAt,
      lastError: account.lastError,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    };
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
