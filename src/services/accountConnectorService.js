const crypto = require('crypto');
const axios = require('axios');
const mongoose = require('mongoose');
const ConnectorAccount = require('../models/ConnectorAccount');
const AuditEvent = require('../models/AuditEvent');
const { CATEGORIES, getCategories, getConnector, getConnectors } = require('./connectorRegistry');
const { buildConnectorSafetyProfile, summarizeConnectorSafety } = require('./connectorSafetyProfile');
const { copyWorkSignalSyncCounts } = require('../utils/workSignalSyncMetadata');
const { getDefaultWorkspaceObjectId, normalizeWorkspaceObjectId } = require('./workspaceScopeService');

const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_CATALOG_LIMIT = 300;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CREDENTIAL_ROTATION_DAYS = 90;
const DEFAULT_CREDENTIAL_ROTATION_WARNING_DAYS = 14;
const CREDENTIAL_ROTATION_AUTH_TYPES = new Set(['api_key', 'personal_access_token', 'basic', 'webhook']);

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

  async getConfluenceSites(accountId, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    this.requireConfluenceAccount(account);
    return this.fetchConfluenceSites(account);
  }

  async selectConfluenceSite(accountId, cloudId, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    this.requireConfluenceAccount(account);
    const requestedCloudId = String(cloudId || '').trim();
    if (!/^[A-Za-z0-9-]{8,100}$/.test(requestedCloudId)) {
      const error = new Error('A valid Confluence cloud ID is required.');
      error.statusCode = 400;
      throw error;
    }

    const sites = await this.fetchConfluenceSites(account);
    const site = sites.find(item => item.cloudId === requestedCloudId);
    if (!site) {
      const error = new Error('That Confluence site is no longer authorized for this account.');
      error.statusCode = 403;
      throw error;
    }

    account.metadata = {
      ...(account.metadata || {}),
      fields: {
        ...(account.metadata?.fields || {}),
        confluenceCloudId: site.cloudId
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

  async getBasecampAccounts(accountId, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    this.requireBasecampAccount(account);
    return this.fetchBasecampAccounts(account);
  }

  async selectBasecampAccount(accountId, basecampAccountId, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    this.requireBasecampAccount(account);
    const requestedAccountId = String(basecampAccountId || '').trim();
    if (!/^\d{1,20}$/.test(requestedAccountId)) {
      const error = new Error('A valid Basecamp account ID is required.');
      error.statusCode = 400;
      throw error;
    }

    const accounts = await this.fetchBasecampAccounts(account);
    const selected = accounts.find(item => item.basecampAccountId === requestedAccountId);
    if (!selected) {
      const error = new Error('That Basecamp account is no longer authorized for this connection.');
      error.statusCode = 403;
      throw error;
    }

    account.metadata = {
      ...(account.metadata || {}),
      fields: {
        ...(account.metadata?.fields || {}),
        basecampAccountId: selected.basecampAccountId,
        basecampApiUrl: selected.apiUrl
      }
    };
    account.accountName = `${account.connectorName} - ${selected.name}`;
    account.externalAccountId = selected.basecampAccountId;
    account.status = 'connected';
    account.lastError = undefined;
    await account.save();
    return this.sanitizeAccount(account);
  }

  async getResourceGuruAccounts(accountId, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    this.requireResourceGuruAccount(account);
    return this.fetchResourceGuruAccounts(account);
  }

  async selectResourceGuruAccount(accountId, resourceGuruAccountId, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    this.requireResourceGuruAccount(account);
    const requestedAccountId = String(resourceGuruAccountId || '').trim();
    if (!/^\d{1,20}$/.test(requestedAccountId)) {
      const error = new Error('A valid Resource Guru account ID is required.');
      error.statusCode = 400;
      throw error;
    }

    const accounts = await this.fetchResourceGuruAccounts(account);
    const selected = accounts.find(item => item.resourceGuruAccountId === requestedAccountId);
    if (!selected) {
      const error = new Error('That Resource Guru account is no longer authorized for this connection.');
      error.statusCode = 403;
      throw error;
    }

    account.metadata = {
      ...(account.metadata || {}),
      fields: {
        ...(account.metadata?.fields || {}),
        resourceGuruAccountId: selected.resourceGuruAccountId,
        resourceGuruAccountUrlId: selected.accountUrlId
      }
    };
    account.accountName = `${account.connectorName} - ${selected.name}`;
    account.externalAccountId = selected.resourceGuruAccountId;
    account.status = 'connected';
    account.lastError = undefined;
    await account.save();
    return this.sanitizeAccount(account);
  }

  async selectFigmaTeam(accountId, figmaTeamId, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    this.requireFigmaAccount(account);
    const requestedTeamId = String(figmaTeamId || '').trim();
    if (!/^\d{1,24}$/.test(requestedTeamId)) {
      const error = new Error('A valid Figma team ID is required. Copy the numeric ID from the team URL in Figma.');
      error.statusCode = 400;
      throw error;
    }

    account.metadata = {
      ...(account.metadata || {}),
      fields: {
        ...(account.metadata?.fields || {}),
        figmaTeamId: requestedTeamId
      }
    };
    account.status = 'connected';
    account.lastError = undefined;
    await account.save();
    return this.sanitizeAccount(account);
  }

  async getSharePointSites(accountId, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    this.requireSharePointAccount(account);
    return this.fetchSharePointSites(account);
  }

  async getMuralWorkspaces(accountId, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    if (account.connectorId !== 'mural') { const error = new Error('Mural workspace selection is only available for Mural connector accounts.'); error.statusCode = 400; throw error; }
    const credentials = this.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) { const error = new Error('Mural access token is missing. Reconnect this account to continue.'); error.statusCode = 503; throw error; }
    const maxResponseBytes = Number.parseInt(process.env.SNEUP_MURAL_MAX_RESPONSE_BYTES, 10);
    const response = await this.http.get('https://app.mural.co/api/public/v1/workspaces', { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, timeout: 15000, maxContentLength: Number.isFinite(maxResponseBytes) ? Math.max(1024, Math.min(10000000, maxResponseBytes)) : 2000000, maxBodyLength: Number.isFinite(maxResponseBytes) ? Math.max(1024, Math.min(10000000, maxResponseBytes)) : 2000000, maxRedirects: 0, proxy: false });
    const values = Array.isArray(response.data?.value) ? response.data.value : Array.isArray(response.data) ? response.data : [];
    return values.filter(item => /^[A-Za-z0-9_-]{1,128}$/.test(String(item?.id || ''))).map(item => ({ muralWorkspaceId: String(item.id), name: String(item.name || 'Mural workspace').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Mural workspace' }));
  }

  async selectMuralWorkspace(accountId, muralWorkspaceId, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    const requested = String(muralWorkspaceId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(requested)) { const error = new Error('A valid Mural workspace ID is required.'); error.statusCode = 400; throw error; }
    const workspaces = await this.getMuralWorkspaces(accountId, options);
    if (!workspaces.some(item => item.muralWorkspaceId === requested)) { const error = new Error('That Mural workspace is no longer authorized for this connection.'); error.statusCode = 403; throw error; }
    account.metadata = { ...(account.metadata || {}), fields: { ...(account.metadata?.fields || {}), muralWorkspaceId: requested } };
    account.accountName = account.connectorName; account.externalAccountId = requested; account.status = 'connected'; account.lastError = undefined; await account.save();
    return this.sanitizeAccount(account);
  }

  async selectSharePointSite(accountId, sharePointSiteId, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    this.requireSharePointAccount(account);
    const requestedSiteId = String(sharePointSiteId || '').trim();
    if (!/^[A-Za-z0-9._,-]{1,512}$/.test(requestedSiteId)) {
      const error = new Error('A valid SharePoint site ID is required.');
      error.statusCode = 400;
      throw error;
    }

    const sites = await this.fetchSharePointSites(account);
    const site = sites.find(item => item.sharePointSiteId === requestedSiteId);
    if (!site) {
      const error = new Error('That SharePoint site is no longer available through this account.');
      error.statusCode = 403;
      throw error;
    }

    account.metadata = {
      ...(account.metadata || {}),
      fields: {
        ...(account.metadata?.fields || {}),
        sharePointSiteId: site.sharePointSiteId
      }
    };
    account.accountName = account.connectorName;
    account.externalAccountId = site.sharePointSiteId;
    account.status = 'connected';
    account.lastError = undefined;
    await account.save();
    return this.sanitizeAccount(account);
  }

  async getXeroTenants(accountId, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    this.requireXeroAccount(account);
    return this.fetchXeroTenants(account);
  }

  async selectXeroTenant(accountId, xeroTenantId, options = {}) {
    const account = await this.getManagedAccount(accountId, options);
    this.requireXeroAccount(account);
    const requestedTenantId = String(xeroTenantId || '').trim().toLowerCase();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(requestedTenantId)) {
      const error = new Error('A valid Xero organisation ID is required.');
      error.statusCode = 400;
      throw error;
    }

    const tenants = await this.fetchXeroTenants(account);
    const tenant = tenants.find(item => item.xeroTenantId === requestedTenantId);
    if (!tenant) {
      const error = new Error('That Xero organisation is no longer authorized for this connection.');
      error.statusCode = 403;
      throw error;
    }

    account.metadata = {
      ...(account.metadata || {}),
      fields: {
        ...(account.metadata?.fields || {}),
        xeroTenantId: tenant.xeroTenantId
      }
    };
    account.accountName = account.connectorName;
    account.externalAccountId = tenant.xeroTenantId;
    account.status = 'connected';
    account.lastError = undefined;
    await account.save();
    return this.sanitizeAccount(account);
  }

  getCatalog(filters = {}) {
    const { category, readiness, search, limit, offset } = this.normalizeCatalogFilter(filters);
    const catalogConnectors = getConnectors();
    const filteredConnectors = this.filterConnectors(category, readiness, search, catalogConnectors);
    const slicedConnectors = typeof limit === 'number' && limit > 0
      ? filteredConnectors.slice(offset || 0, (offset || 0) + limit)
      : filteredConnectors.slice(offset || 0);

    return {
      categories: getCategories(),
      connectors: slicedConnectors.map(connector => this.sanitizeConnector(connector)),
      safety: summarizeConnectorSafety(filteredConnectors),
      total: filteredConnectors.length,
      catalogTotal: catalogConnectors.length,
      syncReadiness: this.summarizeCatalogSyncReadiness(catalogConnectors),
      offset,
      limit
    };
  }

  summarizeCatalogSyncReadiness(connectors) {
    const readiness = connectors.reduce((summary, connector) => {
      if (this.getSyncReadiness(connector).accountConnectionAvailable) {
        summary.ready += 1;
      } else {
        summary.catalogOnly += 1;
      }
      return summary;
    }, { ready: 0, catalogOnly: 0 });

    return {
      ...readiness,
      total: connectors.length
    };
  }

  normalizeCatalogFilter(filters = {}) {
    const category = this.normalizeCategory(filters.category);
    const readiness = this.normalizeReadiness(filters.readiness);
    const search = filters.search || filters.query || '';
    const limit = clampPositiveInt(filters.limit, 0, 0, MAX_CATALOG_LIMIT);
    const offset = clampPositiveInt(filters.offset, 0, 0);
    return {
      category,
      readiness,
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

  normalizeReadiness(readiness) {
    const candidate = normalizeText(readiness);
    if (candidate === 'ready') return 'ready';
    if (candidate === 'catalogonly' || candidate === 'catalog') return 'catalog_only';
    return undefined;
  }

  filterConnectors(category, readiness, search, connectors = getConnectors()) {

    if (category) {
      connectors = connectors.filter((connector) => connector.category === category);
    }

    if (readiness) {
      connectors = connectors.filter((connector) => this.getSyncReadiness(connector).status === readiness);
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
    this.requireAccountConnectionAvailable(connector);
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
    const pkceVerifier = connector.auth.pkce ? this.createPkceVerifier() : undefined;
    const state = this.createState({
      connectorId: connector.id,
      returnTo: this.sanitizeReturnTo(options.returnTo),
      workspaceId: String(this.resolveWorkspaceId(options.workspaceId)),
      consent: this.createConsentEvidence(connector, options),
      pkce: pkceVerifier ? this.encryptStateValue(pkceVerifier) : undefined
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
    if (pkceVerifier) {
      authUrl.searchParams.set('code_challenge', crypto.createHash('sha256').update(pkceVerifier).digest('base64url'));
      authUrl.searchParams.set('code_challenge_method', 'S256');
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
    this.requireAccountConnectionAvailable(connector);
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

    const callbackMetadata = this.extractOAuthCallbackMetadata(connector, query);
    const pkceVerifier = connector.auth.pkce ? this.decryptStateValue(state.pkce) : undefined;
    const tokenResponse = await this.exchangeCodeForToken(connector, query.code, options.baseUrl, pkceVerifier);
    const account = await this.saveOAuthAccount(connector, tokenResponse, {
      workspaceId: state.workspaceId || options.workspaceId,
      consent: state.consent,
      callbackMetadata
    });

    return {
      account: this.sanitizeAccount(account),
      returnTo: state.returnTo || '/?connectors=1'
    };
  }

  async saveCredentialAccount(connectorId, body = {}, options = {}) {
    const connector = this.requireConnector(connectorId);
    this.requireAccountConnectionAvailable(connector);

    if (connector.auth.type === 'oauth2') {
      const error = new Error('Use the OAuth connect endpoint for this connector');
      error.statusCode = 400;
      throw error;
    }

    this.requireDatabase();
    this.requireEncryptionKey();
    const { secretPayload, metadataFields } = this.prepareCredentialPayload(connector, body);

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

  async rotateCredentialAccount(accountId, body = {}, options = {}) {
    this.requireDatabase();
    this.requireEncryptionKey();

    const account = await this.getManagedAccount(accountId, options);
    const connector = this.requireConnector(account.connectorId);
    this.requireAccountConnectionAvailable(connector);
    if (connector.auth.type === 'oauth2' || account.authType === 'oauth2') {
      const error = new Error('OAuth accounts must be reconnected through their provider authorization flow');
      error.statusCode = 400;
      throw error;
    }
    if (account.authType !== connector.auth.type) {
      const error = new Error('Connector account authentication type does not match its catalog definition');
      error.statusCode = 409;
      throw error;
    }

    const { secretPayload, metadataFields } = this.prepareCredentialPayload(connector, body);
    const beforeState = this.sanitizeAccount(account);
    const rollback = {
      credentials: { ...(account.credentials || {}) },
      metadata: this.cloneMetadata(account.metadata),
      accountName: account.accountName,
      externalAccountId: account.externalAccountId,
      consent: { ...(account.consent || {}) },
      status: account.status,
      lastValidatedAt: account.lastValidatedAt,
      lastError: account.lastError,
      credentialsLastRotatedAt: account.credentialsLastRotatedAt
    };

    account.credentials = {
      apiKey: Object.keys(secretPayload).length > 0 ? this.encrypt(JSON.stringify(secretPayload)) : undefined
    };
    account.metadata = {
      ...(account.metadata || {}),
      fields: { ...(account.metadata?.fields || {}), ...metadataFields },
      sync: connector.sync || account.metadata?.sync || []
    };
    account.accountName = body.accountName || account.accountName || metadataFields.workspaceUrl || metadataFields.baseUrl || connector.name;
    account.externalAccountId = body.externalAccountId || account.externalAccountId || account.accountName;
    account.consent = this.createConsentEvidence(connector, {
      ...options,
      scopeAcknowledged: body.scopeAcknowledged === true
    });
    account.status = 'connected';
    account.lastValidatedAt = new Date();
    account.lastError = undefined;
    account.credentialsLastRotatedAt = new Date();

    await account.save();
    try {
      await this.recordCredentialRotationAudit(account, options.actorId, beforeState);
    } catch (error) {
      Object.assign(account, rollback);
      await account.save();
      const auditError = new Error('Connector credentials were not rotated because audit evidence could not be recorded');
      auditError.statusCode = 503;
      throw auditError;
    }

    return this.sanitizeAccount(account);
  }

  prepareCredentialPayload(connector, body = {}) {
    const safety = buildConnectorSafetyProfile(connector);
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

    return fields.reduce((result, field) => {
      if (body[field.name] === undefined) return result;
      if (field.secret) result.secretPayload[field.name] = body[field.name];
      else result.metadataFields[field.name] = body[field.name];
      return result;
    }, { secretPayload: {}, metadataFields: {} });
  }

  cloneMetadata(metadata = {}) {
    return JSON.parse(JSON.stringify(metadata || {}));
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

  requireConfluenceAccount(account) {
    if (account.connectorId !== 'confluence') {
      const error = new Error('Confluence site selection is only available for Confluence connector accounts.');
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

  requireBasecampAccount(account) {
    if (account.connectorId !== 'basecamp') {
      const error = new Error('Basecamp account selection is only available for Basecamp connector accounts.');
      error.statusCode = 400;
      throw error;
    }
  }

  requireResourceGuruAccount(account) {
    if (account.connectorId !== 'resource_guru') {
      const error = new Error('Resource Guru account selection is only available for Resource Guru connector accounts.');
      error.statusCode = 400;
      throw error;
    }
  }

  requireFigmaAccount(account) {
    if (account.connectorId !== 'figma') {
      const error = new Error('Figma team configuration is only available for Figma connector accounts.');
      error.statusCode = 400;
      throw error;
    }
  }

  requireSharePointAccount(account) {
    if (account.connectorId !== 'sharepoint') {
      const error = new Error('SharePoint site selection is only available for SharePoint connector accounts.');
      error.statusCode = 400;
      throw error;
    }
  }

  requireXeroAccount(account) {
    if (account.connectorId !== 'xero') {
      const error = new Error('Xero organisation selection is only available for Xero connector accounts.');
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

  async fetchConfluenceSites(account) {
    const credentials = this.getAccountCredentials(account);
    const accessToken = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!accessToken) {
      const error = new Error('Confluence access token is missing. Reconnect this account to continue.');
      error.statusCode = 503;
      throw error;
    }

    const response = await this.http.get('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      timeout: 15000,
      maxRedirects: 0,
      proxy: false
    });

    return (Array.isArray(response.data) ? response.data : [])
      .filter(site => /^[A-Za-z0-9-]{8,100}$/.test(String(site?.id || '')))
      .filter(site => ['read:page:confluence', 'read:space:confluence'].every(scope => (site.scopes || []).includes(scope)))
      .map(site => ({
        cloudId: site.id,
        name: String(site.name || site.id),
        url: typeof site.url === 'string' && /^https:\/\/[A-Za-z0-9.-]+\.atlassian\.net(?:\/|$)/.test(site.url) ? site.url : undefined
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

  async fetchSharePointSites(account) {
    const credentials = this.getAccountCredentials(account);
    const accessToken = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!accessToken) {
      const error = new Error('SharePoint access token is missing. Reconnect this account to continue.');
      error.statusCode = 503;
      throw error;
    }

    const response = await this.http.get('https://graph.microsoft.com/v1.0/me/followedSites', {
      params: { '$select': 'id,displayName' },
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      timeout: 15000,
      maxRedirects: 0,
      proxy: false
    });

    return (Array.isArray(response.data?.value) ? response.data.value : [])
      .filter(site => /^[A-Za-z0-9._,-]{1,512}$/.test(String(site?.id || '')))
      .map(site => ({
        sharePointSiteId: String(site.id),
        name: String(site.displayName || 'SharePoint site').replace(/\s+/g, ' ').trim().slice(0, 160) || 'SharePoint site'
      }));
  }

  async fetchXeroTenants(account) {
    const credentials = this.getAccountCredentials(account);
    const accessToken = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!accessToken) {
      const error = new Error('Xero access token is missing. Reconnect this account to continue.');
      error.statusCode = 503;
      throw error;
    }

    const response = await this.http.get('https://api.xero.com/connections', {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      timeout: 15000,
      maxRedirects: 0,
      proxy: false
    });

    return (Array.isArray(response.data) ? response.data : [])
      .filter(tenant => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(tenant?.tenantId || '')))
      .map(tenant => ({
        xeroTenantId: String(tenant.tenantId).toLowerCase(),
        name: String(tenant.tenantName || 'Xero organisation').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Xero organisation'
      }));
  }

  getBasecampLaunchpadUrl() {
    const raw = String(process.env.SNEUP_BASECAMP_LAUNCHPAD_URL || 'https://launchpad.37signals.com').trim();
    let url;
    try {
      url = new URL(raw);
    } catch {
      const error = new Error('Basecamp Launchpad URL must be https://launchpad.37signals.com.');
      error.statusCode = 500;
      throw error;
    }
    if (url.protocol !== 'https:' || url.hostname !== 'launchpad.37signals.com' || url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      const error = new Error('Basecamp Launchpad URL must be https://launchpad.37signals.com.');
      error.statusCode = 500;
      throw error;
    }
    return url.origin;
  }

  normalizeBasecampApiUrl(value, accountId) {
    let url;
    try {
      url = new URL(String(value || ''));
    } catch {
      return null;
    }
    const expectedPath = `/${accountId}`;
    if (url.protocol !== 'https:' || url.hostname !== '3.basecampapi.com' || url.port || url.pathname !== expectedPath || url.search || url.hash || url.username || url.password) return null;
    return url.toString().replace(/\/$/, '');
  }

  async fetchBasecampAccounts(account) {
    const credentials = this.getAccountCredentials(account);
    const accessToken = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!accessToken) {
      const error = new Error('Basecamp access token is missing. Reconnect this account to continue.');
      error.statusCode = 503;
      throw error;
    }

    const response = await this.http.get(`${this.getBasecampLaunchpadUrl()}/authorization.json`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'Sneup Digital Project Manager'
      },
      timeout: 15000
    });

    return (Array.isArray(response.data?.accounts) ? response.data.accounts : [])
      .filter(item => item?.product === 'bc3' && /^\d{1,20}$/.test(String(item.id || '')))
      .map(item => {
        const basecampAccountId = String(item.id);
        const apiUrl = this.normalizeBasecampApiUrl(item.href, basecampAccountId);
        return apiUrl ? {
          basecampAccountId,
          name: String(item.name || `Basecamp account ${basecampAccountId}`),
          apiUrl
        } : null;
      })
      .filter(Boolean);
  }

  async fetchResourceGuruAccounts(account) {
    const credentials = this.getAccountCredentials(account);
    const accessToken = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!accessToken) {
      const error = new Error('Resource Guru access token is missing. Reconnect this account to continue.');
      error.statusCode = 503;
      throw error;
    }

    const response = await this.http.get('https://api.resourceguruapp.com/v1/accounts', {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'Sneup Digital Project Manager'
      },
      timeout: 15000,
      maxRedirects: 0,
      proxy: false
    });

    return (Array.isArray(response.data) ? response.data : [])
      .filter(item => /^\d{1,20}$/.test(String(item?.id || '')))
      .map(item => {
        const accountUrlId = String(item.subdomain || '').trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(accountUrlId)) return null;
        const resourceGuruAccountId = String(item.id);
        return {
          resourceGuruAccountId,
          accountUrlId,
          name: String(item.name || `Resource Guru account ${resourceGuruAccountId}`)
        };
      })
      .filter(Boolean);
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

  async exchangeCodeForToken(connector, code, baseUrl, pkceVerifier) {
    const config = this.getOAuthEnvironment(connector);
    const redirectUri = this.getRedirectUri(connector.id, baseUrl);
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', redirectUri);
    body.set('client_id', config.clientId);
    if (connector.auth.pkce) {
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(String(pkceVerifier || ''))) {
        const error = new Error('OAuth PKCE verifier is missing or invalid. Start the connector authorization again.');
        error.statusCode = 400;
        throw error;
      }
      body.set('code_verifier', pkceVerifier);
    }

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
      options.callbackMetadata?.quickBooksRealmId ||
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
        fields: {
          ...this.extractOAuthMetadata(connector, tokenResponse),
          ...(options.callbackMetadata || {})
        },
        providerResponseKeys: Object.keys(tokenResponse || {}),
        sync: connector.sync || []
      },
      lastValidatedAt: new Date()
    });

    await account.save();
    await this.recordConnectionAudit(account, options.consent?.acknowledgedBy);
    return account;
  }

  extractOAuthMetadata(connector, tokenResponse = {}) {
    const declarations = connector.auth?.oauthResponseMetadata || [];
    return declarations.reduce((fields, declaration) => {
      const value = tokenResponse[declaration.responseKey];
      if (!value && !declaration.required) return fields;
      if (declaration.validator === 'salesforceInstanceUrl') {
        fields[declaration.field] = this.validateSalesforceInstanceUrl(value);
        return fields;
      }
      if (declaration.validator === 'miroTeamId') {
        fields[declaration.field] = this.validateMiroTeamId(value);
        return fields;
      }
      const error = new Error(`Connector ${connector.id} declared an unsupported OAuth metadata validator`);
      error.statusCode = 500;
      throw error;
    }, {});
  }

  extractOAuthCallbackMetadata(connector, query = {}) {
    const declarations = connector.auth?.oauthCallbackMetadata || [];
    return declarations.reduce((fields, declaration) => {
      const value = query[declaration.queryKey];
      if (!value && !declaration.required) return fields;
      if (declaration.validator === 'quickBooksRealmId') {
        fields[declaration.field] = this.validateQuickBooksRealmId(value);
        return fields;
      }
      const error = new Error(`Connector ${connector.id} declared an unsupported OAuth callback metadata validator`);
      error.statusCode = 500;
      throw error;
    }, {});
  }

  validateSalesforceInstanceUrl(value) {
    let url;
    try {
      url = new URL(String(value || ''));
    } catch (_error) {
      const error = new Error('Salesforce OAuth did not return a valid HTTPS instance URL. Reconnect this account to continue.');
      error.statusCode = 502;
      throw error;
    }

    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !hostname.endsWith('.salesforce.com') || !['', '/'].includes(url.pathname)) {
      const error = new Error('Salesforce OAuth returned an unsupported instance URL. Reconnect this account to continue.');
      error.statusCode = 502;
      throw error;
    }
    return `https://${hostname}`;
  }

  validateMiroTeamId(value) {
    const teamId = String(value || '').trim();
    if (!/^\d{8,24}$/.test(teamId)) {
      const error = new Error('Miro OAuth did not return a valid team ID. Reconnect this account to continue.');
      error.statusCode = 502;
      throw error;
    }
    return teamId;
  }

  validateQuickBooksRealmId(value) {
    const realmId = String(value || '').trim();
    if (!/^\d{1,32}$/.test(realmId)) {
      const error = new Error('QuickBooks OAuth did not return a valid company realm ID. Reconnect this account to continue.');
      error.statusCode = 502;
      throw error;
    }
    return realmId;
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

  async recordCredentialRotationAudit(account, actor, beforeState) {
    await AuditEvent.create({
      workspaceId: account.workspaceId,
      entityType: 'connector_account',
      entityId: account._id,
      action: 'connector_account_credentials_rotated',
      actor: actor || account.connectedBy || 'local-user',
      source: 'api',
      riskLevel: account.consent?.scopeReviewRequired ? 'medium' : 'low',
      beforeState,
      afterState: this.sanitizeAccount(account)
    });
  }

  sanitizeConnector(connector) {
    const syncReadiness = this.getSyncReadiness(connector);
    return {
      id: connector.id,
      name: connector.name,
      category: connector.category,
      categoryName: CATEGORIES[connector.category],
      description: connector.description,
      auth: {
        type: connector.auth.type,
        displayType: connector.auth.displayType,
        docsUrl: connector.auth.docsUrl,
        scopes: connector.auth.scopes || [],
        fields: connector.auth.fields || [],
        configured: connector.auth.type !== 'oauth2' || this.hasOAuthEnvironment(connector)
      },
      safety: buildConnectorSafetyProfile(connector),
      syncReadiness,
      sync: connector.sync || []
    };
  }

  getCredentialRotationPolicy(environment = process.env) {
    const rotationDays = clampPositiveInt(
      environment.SNEUP_CONNECTOR_CREDENTIAL_ROTATION_DAYS,
      DEFAULT_CREDENTIAL_ROTATION_DAYS,
      30,
      365
    );
    const warningDays = clampPositiveInt(
      environment.SNEUP_CONNECTOR_CREDENTIAL_ROTATION_WARNING_DAYS,
      DEFAULT_CREDENTIAL_ROTATION_WARNING_DAYS,
      1,
      Math.max(1, rotationDays - 1)
    );

    return { rotationDays, warningDays };
  }

  getCredentialRotationHealth(account, options = {}) {
    const { rotationDays, warningDays } = this.getCredentialRotationPolicy(options.environment);
    const required = CREDENTIAL_ROTATION_AUTH_TYPES.has(account?.authType);
    if (!required) {
      return { required: false, status: 'not_required' };
    }

    const referenceDate = new Date(account?.credentialsLastRotatedAt || account?.createdAt || 0);
    if (Number.isNaN(referenceDate.getTime()) || referenceDate.getTime() === 0) {
      return { required: true, status: 'unknown', rotationDays, warningDays };
    }

    const now = options.now instanceof Date ? options.now : new Date();
    const dueAt = new Date(referenceDate.getTime() + rotationDays * DAY_MS);
    const ageDays = Math.max(0, Math.floor((now.getTime() - referenceDate.getTime()) / DAY_MS));
    const daysUntilDue = Math.ceil((dueAt.getTime() - now.getTime()) / DAY_MS);
    const status = daysUntilDue <= 0 ? 'overdue' : daysUntilDue <= warningDays ? 'due_soon' : 'current';

    return {
      required: true,
      status,
      rotationDays,
      warningDays,
      referenceAt: referenceDate.toISOString(),
      dueAt: dueAt.toISOString(),
      ageDays,
      daysUntilDue
    };
  }

  sanitizeAccount(account, options = {}) {
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
      credentialsLastRotatedAt: account.credentialsLastRotatedAt || null,
      credentialRotation: this.getCredentialRotationHealth(account, options),
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
        signalWriteBatchCount: Math.max(0, Math.min(1000000, Math.floor(Number(lastSync.signalWriteBatchCount) || 0))),
        signalWriteBatchSize: Math.max(0, Math.min(500, Math.floor(Number(lastSync.signalWriteBatchSize) || 0))),
        hasMore: Boolean(lastSync.hasMore),
        retryCount: Number(lastSync.retryCount || 0),
        rateLimitWaitMs: Number(lastSync.rateLimitWaitMs || 0),
        attemptCount: Number(lastSync.attemptCount || 0),
        source: lastSync.source || undefined,
        ...copyWorkSignalSyncCounts(lastSync),
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

  getSyncReadiness(connector) {
    // Adapter clients depend on this service for in-process credential decryption.
    // Resolving them only when readiness is read avoids capturing a partial export
    // when the scheduled sync service is loaded before the connector routes.
    const workSignalAdapterService = require('./workSignalAdapterService');
    const adapter = workSignalAdapterService.getAdapter(connector.id);
    const accountConnectionAvailable = Boolean(adapter?.capabilities?.credentialBackedSync);
    const availability = connector.availability || {};
    return {
      status: accountConnectionAvailable ? 'ready' : 'catalog_only',
      accountConnectionAvailable,
      readOnly: true,
      availabilityStatus: accountConnectionAvailable ? 'available' : availability.status || 'unavailable',
      reason: accountConnectionAvailable ? undefined : availability.reason || 'A bounded read-only account-sync contract has not been verified for this provider.'
    };
  }

  requireAccountConnectionAvailable(connector) {
    if (this.getSyncReadiness(connector).accountConnectionAvailable) return;

    const reason = this.getSyncReadiness(connector).reason;
    const error = new Error(`${connector.name} is listed in the connector catalog, but its secure work-signal sync is unavailable. ${reason}`);
    error.statusCode = 409;
    throw error;
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

  createPkceVerifier() {
    return crypto.randomBytes(64).toString('base64url');
  }

  encryptStateValue(value) {
    const iv = crypto.randomBytes(12);
    const key = crypto.createHash('sha256').update(this.getStateSecret()).digest();
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  decryptStateValue(value) {
    try {
      const [ivValue, tagValue, encryptedValue, ...extra] = String(value || '').split('.');
      if (extra.length || !ivValue || !tagValue || !encryptedValue) throw new Error('invalid state encryption envelope');
      const key = crypto.createHash('sha256').update(this.getStateSecret()).digest();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
    } catch (_error) {
      const error = new Error('OAuth PKCE state is missing or invalid. Start the connector authorization again.');
      error.statusCode = 400;
      throw error;
    }
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
