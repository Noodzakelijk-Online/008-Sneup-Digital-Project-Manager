const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const mongoose = require('mongoose');
const path = require('path');

const {
  getPermissionsForRoles,
  hasPermission,
  requireApiAccess,
  requirePermission,
  verifyTrelloWebhook
} = require('../src/utils/requestSecurity');

const accountConnectorService = require('../src/services/accountConnectorService');
const enhancementBacklog = require('../src/services/enhancementBacklog');
const { getCategories, getConnectors } = require('../src/services/connectorRegistry');

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  }
});

const createRequest = (overrides = {}) => ({
  path: '/api/connectors',
  method: 'GET',
  ip: '203.0.113.10',
  connection: { remoteAddress: '203.0.113.10' },
  socket: { remoteAddress: '203.0.113.10' },
  get: () => undefined,
  ...overrides
});

describe('request security boundaries', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.dontMock('../src/utils/database');
    jest.dontMock('../src/models/ApiToken');
    jest.dontMock('../src/models/SessionToken');
    jest.dontMock('../src/models/DecisionQueueItem');
    jest.dontMock('../src/models/Recommendation');
    jest.dontMock('../src/models/TrelloActionAttempt');
    jest.dontMock('../src/models/FollowUpPlan');
    jest.dontMock('../src/models/CardFinding');
    jest.dontMock('../src/models/BoardHealthSnapshot');
    jest.dontMock('../src/models/WorkActor');
    jest.dontMock('../src/models/WorkComment');
    jest.dontMock('../src/models/WorkContainer');
    jest.dontMock('../src/models/WorkDependency');
    jest.dontMock('../src/models/WorkEvent');
    jest.dontMock('../src/models/WorkItem');
    jest.dontMock('../src/services/workspaceScopeService');
    jest.dontMock('../src/services/githubWorkSignalClient');
    jest.dontMock('../src/services/trelloWorkSignalClient');
    jest.dontMock('../src/services/jiraWorkSignalClient');
    jest.dontMock('../src/services/teamManager');
    jest.dontMock('mongoose');
  });

  test('blocks remote API access when no API key is configured', async () => {
    delete process.env.SNEUP_API_KEY;
    process.env.SNEUP_REQUIRE_API_KEY = 'false';

    const req = createRequest();
    const res = createResponse();
    const next = jest.fn();

    await requireApiAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toContain('SNEUP_API_KEY');
  });

  test('allows a valid configured API key and attaches service identity', async () => {
    process.env.SNEUP_API_KEY = 'test-api-key';
    process.env.SNEUP_DEFAULT_WORKSPACE_ID = 'workspace-main';
    process.env.SNEUP_DEFAULT_WORKSPACE_NAME = 'Main Ops';
    process.env.SNEUP_SERVICE_ACTOR = 'service-sneup';

    const req = createRequest({
      get: header => (header.toLowerCase() === 'x-sneup-api-key' ? 'test-api-key' : undefined)
    });
    const res = createResponse();
    const next = jest.fn();

    await requireApiAccess(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(req.auth).toMatchObject({
      authenticated: true,
      authMethod: 'api_key',
      actorType: 'service',
      actorId: 'service-sneup',
      workspaceId: 'workspace-main',
      workspaceName: 'Main Ops',
      roles: ['service']
    });
    expect(req.auth.permissions).toEqual(expect.arrayContaining(['audit:read', 'trello-actions:execute-approved']));
  });

  test('allows service contexts to select a workspace for dashboard operations', async () => {
    process.env.SNEUP_API_KEY = 'test-api-key';
    process.env.SNEUP_DEFAULT_WORKSPACE_ID = 'workspace-main';

    const req = createRequest({
      get: header => {
        const normalized = header.toLowerCase();
        if (normalized === 'x-sneup-api-key') return 'test-api-key';
        if (normalized === 'x-sneup-workspace-id') return 'tenant-b';
        return undefined;
      }
    });
    const res = createResponse();
    const next = jest.fn();

    await requireApiAccess(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth.workspaceId).toBe('tenant-b');
    expect(req.auth.workspaceOverrideAllowed).toBe(true);
  });

  test('local API bypass still attaches an auditable owner identity', async () => {
    delete process.env.SNEUP_API_KEY;
    process.env.SNEUP_REQUIRE_API_KEY = 'false';

    const req = createRequest({
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' }
    });
    const res = createResponse();
    const next = jest.fn();

    await requireApiAccess(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth).toMatchObject({
      authenticated: true,
      authMethod: 'local_bypass',
      actorType: 'local_user',
      actorId: 'local-user',
      roles: ['owner'],
      workspaceId: 'default'
    });
  });

  test('resolves an active database API token into user and workspace context', async () => {
    jest.resetModules();

    const candidate = {
      _id: 'token-1',
      name: 'Ops token',
      role: 'operator',
      scopes: [],
      workspaceId: { _id: 'workspace-1', name: 'Ops Workspace' },
      userId: { _id: 'user-1', displayName: 'Operations Lead', role: 'manager', status: 'active' },
      isUsable: jest.fn(() => true),
      matches: jest.fn(() => true),
      save: jest.fn().mockResolvedValue(null)
    };
    const query = {
      select: jest.fn(() => query),
      populate: jest.fn()
    };
    query.populate.mockReturnValueOnce(query).mockResolvedValueOnce(candidate);

    jest.doMock('../src/utils/database', () => ({ isDatabaseConnected: () => true }));
    jest.doMock('../src/models/ApiToken', () => ({
      prefixFor: jest.fn(token => String(token).slice(0, 10)),
      findOne: jest.fn(() => query)
    }));

    const { requireApiAccess } = require('../src/utils/requestSecurity');
    delete process.env.SNEUP_API_KEY;

    const req = createRequest({
      get: header => {
        const normalized = header.toLowerCase();
        if (normalized === 'x-sneup-api-key') return 'db-secret-token';
        if (normalized === 'x-sneup-workspace-id') return 'tenant-b';
        return undefined;
      }
    });
    const res = createResponse();
    const next = jest.fn();

    await requireApiAccess(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth).toMatchObject({
      authenticated: true,
      authMethod: 'database_api_token',
      actorType: 'user',
      actorId: 'user-1',
      displayName: 'Operations Lead',
      workspaceId: 'workspace-1',
      workspaceName: 'Ops Workspace',
      roles: ['manager'],
      tokenId: 'token-1',
      userId: 'user-1'
    });
    expect(req.auth.permissions).toEqual(expect.arrayContaining(['approvals:decide']));
    expect(req.auth.workspaceOverrideAllowed).toBe(false);
    expect(candidate.save).toHaveBeenCalledTimes(1);
  });

  test('rejects database API tokens attached to disabled users', async () => {
    jest.resetModules();

    const candidate = {
      _id: 'token-2',
      name: 'Disabled token',
      role: 'admin',
      scopes: [],
      workspaceId: { _id: 'workspace-1', name: 'Ops Workspace' },
      userId: { _id: 'user-2', displayName: 'Disabled User', role: 'admin', status: 'disabled' },
      isUsable: jest.fn(() => true),
      matches: jest.fn(() => true),
      save: jest.fn().mockResolvedValue(null)
    };
    const query = {
      select: jest.fn(() => query),
      populate: jest.fn()
    };
    query.populate.mockReturnValueOnce(query).mockResolvedValueOnce(candidate);

    jest.doMock('../src/utils/database', () => ({ isDatabaseConnected: () => true }));
    jest.doMock('../src/models/ApiToken', () => ({
      prefixFor: jest.fn(token => String(token).slice(0, 10)),
      findOne: jest.fn(() => query)
    }));

    const { resolveDatabaseApiToken } = require('../src/utils/requestSecurity');

    await expect(resolveDatabaseApiToken('db-secret-token')).resolves.toBeNull();
    expect(candidate.save).not.toHaveBeenCalled();
  });

  test('resolves an active database session token into user workspace context', async () => {
    jest.resetModules();

    const now = new Date('2026-06-29T09:00:00Z');
    const rawSessionToken = 'sneup_session_test-secret';
    const candidate = {
      _id: 'session-1',
      name: 'Robert laptop',
      workspaceId: { _id: 'workspace-1', name: 'Ops Workspace' },
      userId: {
        _id: 'user-1',
        displayName: 'Robert',
        email: 'robert@example.test',
        role: 'admin',
        status: 'active',
        save: jest.fn().mockResolvedValue(null)
      },
      isUsable: jest.fn(() => true),
      matches: jest.fn(() => true),
      save: jest.fn().mockResolvedValue(null)
    };
    const query = {
      select: jest.fn(() => query),
      populate: jest.fn()
    };
    query.populate.mockReturnValueOnce(query).mockResolvedValueOnce(candidate);

    jest.doMock('../src/utils/database', () => ({ isDatabaseConnected: () => true }));
    jest.doMock('../src/models/SessionToken', () => ({
      prefixFor: jest.fn(token => String(token).slice(0, 18)),
      findOne: jest.fn(() => query)
    }));

    const { resolveDatabaseSessionToken } = require('../src/utils/requestSecurity');

    await expect(resolveDatabaseSessionToken(rawSessionToken, now)).resolves.toMatchObject({
      context: {
        authMethod: 'database_session',
        actorType: 'user',
        actorId: 'user-1',
        displayName: 'Robert',
        workspaceId: 'workspace-1',
        workspaceName: 'Ops Workspace',
        roles: ['admin'],
        tokenId: 'session-1',
        userId: 'user-1'
      }
    });
    expect(candidate.lastUsedAt).toBe(now);
    expect(candidate.userId.lastSeenAt).toBe(now);
    expect(candidate.save).toHaveBeenCalledTimes(1);
    expect(candidate.userId.save).toHaveBeenCalledTimes(1);
  });

  test('enforces role permissions before write handlers run', () => {
    expect(getPermissionsForRoles(['viewer'])).toEqual(expect.arrayContaining(['api:read', 'audit:read']));
    expect(getPermissionsForRoles(['viewer'])).not.toContain('trello-actions:execute-approved');
    expect(getPermissionsForRoles(['manager'])).not.toContain('identity:manage');
    expect(getPermissionsForRoles(['manager'])).toContain('jobs:manage');
    expect(getPermissionsForRoles(['operator'])).not.toContain('jobs:manage');
    expect(getPermissionsForRoles(['admin'])).toContain('identity:manage');
    expect(hasPermission({ roles: ['manager'] }, 'approvals:decide')).toBe(true);
    expect(hasPermission({ roles: ['manager'] }, 'jobs:manage')).toBe(true);
    expect(hasPermission({ roles: ['operator'] }, 'approvals:decide')).toBe(false);

    const allowedReq = createRequest({
      auth: { authenticated: true, roles: ['manager'], permissions: [] }
    });
    const allowedRes = createResponse();
    const allowedNext = jest.fn();

    requirePermission('approvals:decide')(allowedReq, allowedRes, allowedNext);

    expect(allowedNext).toHaveBeenCalledTimes(1);
    expect(allowedRes.statusCode).toBe(200);

    const blockedReq = createRequest({
      auth: { authenticated: true, roles: ['viewer'], permissions: [] }
    });
    const blockedRes = createResponse();
    const blockedNext = jest.fn();

    requirePermission('approvals:decide')(blockedReq, blockedRes, blockedNext);

    expect(blockedNext).not.toHaveBeenCalled();
    expect(blockedRes.statusCode).toBe(403);
    expect(blockedRes.body).toMatchObject({
      success: false,
      requiredPermission: 'approvals:decide'
    });
  });

  test('verifies Trello webhook signatures', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRELLO_WEBHOOK_SECRET = 'trello-secret';
    process.env.WEBHOOK_CALLBACK_URL = 'https://example.com/api/webhooks/trello';

    const rawBody = Buffer.from(JSON.stringify({ action: { id: '1' }, model: { id: '2' } }));
    const signature = crypto
      .createHmac('sha1', process.env.TRELLO_WEBHOOK_SECRET)
      .update(Buffer.concat([rawBody, Buffer.from(process.env.WEBHOOK_CALLBACK_URL)]))
      .digest('base64');

    const req = createRequest({
      path: '/api/webhooks/trello',
      rawBody,
      get: header => (header.toLowerCase() === 'x-trello-webhook' ? signature : undefined)
    });
    const res = createResponse();
    const next = jest.fn();

    verifyTrelloWebhook(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  test('does not trust request host for OAuth redirect URIs by default', () => {
    delete process.env.SNEUP_PUBLIC_URL;
    delete process.env.APP_BASE_URL;
    process.env.SNEUP_TRUST_REQUEST_HOST = 'false';
    process.env.PORT = '3000';

    expect(accountConnectorService.getRedirectUri('github', 'https://evil.example')).toBe(
      'http://127.0.0.1:3000/api/connectors/github/callback'
    );
  });
});

describe('dashboard content security policy', () => {
  test('serves dashboard behavior from external assets without inline script or style allowances', () => {
    const rootDir = path.join(__dirname, '..');
    const html = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
    const appJs = fs.readFileSync(path.join(rootDir, 'public', 'app.js'), 'utf8');
    const styles = fs.readFileSync(path.join(rootDir, 'public', 'styles.css'), 'utf8');
    const server = fs.readFileSync(path.join(rootDir, 'src', 'index.js'), 'utf8');
    const recommendationRoutes = fs.readFileSync(path.join(rootDir, 'src', 'routes', 'recommendations.js'), 'utf8');

    expect(html).toContain('<link rel="stylesheet" href="/styles.css">');
    expect(html).toContain('<script src="/app.js" defer></script>');
    expect(html).toContain('id="signalsView"');
    expect(html).toContain('id="workSignalList"');
    expect(appJs).toContain("fetchApi('/api/work-signals?limit=100')");
    expect(appJs).toContain('data-recommendation-evidence');
    expect(appJs).toContain('/api/recommendations/${recommendationId}/evidence');
    expect(appJs).toContain('data-graph-filter');
    expect(appJs).toContain('data-graph-dependency-review');
    expect(appJs).toContain('renderGraphReviewQuality(graph)');
    expect(appJs).toContain('provider retries');
    expect(appJs).toContain('data-connector-sync');
    expect(appJs).toContain('renderGraphLedgerFilters(graphContext)');
    expect(server).toContain("app.use('/api/work-signals', workSignalRoutes)");
    expect(fs.readFileSync(path.join(rootDir, 'src', 'routes', 'workSignals.js'), 'utf8')).toContain("router.post('/graph/dependencies/:dependencyId/review'");
    expect(recommendationRoutes).toContain("router.get('/:recommendationId/evidence'");
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script>\s*[\s\S]*?<\/script>/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(appJs).not.toMatch(/\sstyle=/i);
    expect(styles.length).toBeGreaterThan(1000);
    expect(appJs.length).toBeGreaterThan(1000);
    expect(server).not.toContain("'unsafe-inline'");
  });
});

describe('workspace identity models', () => {
  test('define workspace-scoped users, boards, cards, connector accounts, and hashed credentials', () => {
    const ApiToken = require('../src/models/ApiToken');
    const SessionToken = require('../src/models/SessionToken');
    const Analytics = require('../src/models/Analytics');
    const Board = require('../src/models/Board');
    const Card = require('../src/models/Card');
    const Comment = require('../src/models/Comment');
    const ConnectorAccount = require('../src/models/ConnectorAccount');
    const Conversation = require('../src/models/Conversation');
    const Approval = require('../src/models/Approval');
    const AuditEvent = require('../src/models/AuditEvent');
    const BoardHealthSnapshot = require('../src/models/BoardHealthSnapshot');
    const CardFinding = require('../src/models/CardFinding');
    const DecisionQueueItem = require('../src/models/DecisionQueueItem');
    const FollowUpPlan = require('../src/models/FollowUpPlan');
    const Intervention = require('../src/models/Intervention');
    const Learning = require('../src/models/Learning');
    const List = require('../src/models/List');
    const Member = require('../src/models/Member');
    const Performance = require('../src/models/Performance');
    const Recommendation = require('../src/models/Recommendation');
    const TrelloActionAttempt = require('../src/models/TrelloActionAttempt');
    const WorkerResponse = require('../src/models/WorkerResponse');
    const WorkSignal = require('../src/models/WorkSignal');
    const WorkDependency = require('../src/models/WorkDependency');
    const User = require('../src/models/User');
    const Workspace = require('../src/models/Workspace');

    const rawToken = 'sneup_test_secret_token';
    const hash = ApiToken.hashToken(rawToken);
    const token = new ApiToken({
      name: 'Automation token',
      tokenPrefix: ApiToken.prefixFor(rawToken),
      tokenHash: hash,
      role: 'service'
    });
    const rawSessionToken = SessionToken.generateRawToken();
    const sessionHash = SessionToken.hashToken(rawSessionToken);
    const session = new SessionToken({
      workspaceId: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      tokenPrefix: SessionToken.prefixFor(rawSessionToken),
      tokenHash: sessionHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });

    expect(hash).not.toBe(rawToken);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(ApiToken.buildSecretRecord(rawToken, { name: 'Seed token' })).toMatchObject({
      name: 'Seed token',
      tokenPrefix: 'sneup_test',
      tokenHash: hash
    });
    expect(token.matches(rawToken)).toBe(true);
    expect(token.matches('wrong-token')).toBe(false);
    expect(token.isUsable()).toBe(true);
    expect(rawSessionToken).toMatch(/^sneup_session_/);
    expect(sessionHash).not.toBe(rawSessionToken);
    expect(sessionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(session.matches(rawSessionToken)).toBe(true);
    expect(session.matches('wrong-token')).toBe(false);
    expect(session.isUsable()).toBe(true);
    expect(SessionToken.schema.path('tokenHash').options.select).toBe(false);
    expect(Workspace.schema.path('slug')).toBeTruthy();
    expect(User.schema.path('role').enumValues).toEqual(expect.arrayContaining(['owner', 'admin', 'manager', 'operator', 'viewer', 'service']));
    expect(Board.schema.path('workspaceId')).toBeTruthy();
    expect(Card.schema.path('workspaceId')).toBeTruthy();
    expect(ConnectorAccount.schema.path('workspaceId')).toBeTruthy();
    expect(WorkDependency.schema.path('targetItemId').isRequired).toBeFalsy();
    expect(WorkDependency.schema.path('targetProvider')).toBeTruthy();
    expect(WorkDependency.schema.path('targetExternalId')).toBeTruthy();
    expect(WorkDependency.schema.path('resolutionStatus').enumValues).toEqual(expect.arrayContaining(['resolved', 'unresolved']));
    expect(WorkDependency.schema.path('freshnessStatus').enumValues).toEqual(expect.arrayContaining(['fresh', 'stale']));
    expect(WorkDependency.schema.path('reviewStatus').enumValues).toEqual(expect.arrayContaining(['unreviewed', 'confirmed', 'dismissed', 'refreshed']));
    expect(WorkDependency.schema.path('lastSeenAt')).toBeTruthy();
    expect(WorkDependency.schema.path('staleSince')).toBeTruthy();
    for (const Model of [
      Approval,
      Analytics,
      AuditEvent,
      BoardHealthSnapshot,
      CardFinding,
      Comment,
      Conversation,
      DecisionQueueItem,
      FollowUpPlan,
      Intervention,
      Learning,
      List,
      Member,
      Performance,
      Recommendation,
      TrelloActionAttempt,
      WorkSignal,
      WorkerResponse
    ]) {
      expect(Model.schema.path('workspaceId')).toBeTruthy();
    }
  });

  test('derives stable workspace object ids and scoped queries from request auth', () => {
    const workspaceScopeService = require('../src/services/workspaceScopeService');
    process.env.SNEUP_DEFAULT_WORKSPACE_ID = 'workspace-main';

    const first = workspaceScopeService.getDefaultWorkspaceObjectId();
    const second = workspaceScopeService.getDefaultWorkspaceObjectId();
    const tenant = workspaceScopeService.getRequestWorkspaceObjectId({
      auth: { workspaceId: 'tenant-a' }
    });
    const query = workspaceScopeService.scopeQuery({ auth: { workspaceId: 'tenant-a' } }, { closed: false });

    expect(String(first)).toMatch(/^[a-f0-9]{24}$/);
    expect(String(first)).toBe(String(second));
    expect(String(tenant)).toBe(String(workspaceScopeService.objectIdFromWorkspaceKey('tenant-a')));
    expect(query).toMatchObject({ closed: false });
    expect(String(query.workspaceId)).toBe(String(tenant));
    expect(workspaceScopeService.slugifyWorkspaceKey('Main Ops Workspace')).toBe('main-ops-workspace');
  });

  test('operations ledger service adds workspace filters to shared queries', () => {
    const operationsLedgerService = require('../src/services/operationsLedgerService');
    const workspaceScopeService = require('../src/services/workspaceScopeService');

    const scoped = operationsLedgerService.workspaceQuery({ workspaceId: 'tenant-a' }, { status: 'open' });

    expect(scoped.status).toBe('open');
    expect(String(scoped.workspaceId)).toBe(String(workspaceScopeService.objectIdFromWorkspaceKey('tenant-a')));
  });
});
describe('connector registry', () => {
  test('covers the modern project manager tool stack', () => {
    expect(getConnectors().length).toBeGreaterThanOrEqual(87);
    expect(Object.keys(getCategories())).toHaveLength(11);
    expect(getConnectors().map(connector => connector.id)).toEqual(
      expect.arrayContaining(['trello', 'jira_software', 'asana', 'slack', 'github', 'notion', 'microsoft_365'])
    );
  });

  test('supports connector search, category aliases, and pagination', () => {
    const result = accountConnectorService.getCatalog({
      category: 'software delivery',
      search: 'jira',
      limit: '2',
      offset: '0'
    });

    expect(result.total).toBeGreaterThanOrEqual(3);
    expect(result.connectors.length).toBe(2);
    expect(result.connectors.map(connector => connector.id)).toEqual(
      expect.arrayContaining(['jira_software', 'jira_service_management'])
    );

    const aliasResult = accountConnectorService.getCatalog({
      category: 'work management'
    });
    expect(aliasResult.connectors.some(connector => connector.id === 'scoro')).toBe(true);
    expect(aliasResult.total).toBeGreaterThanOrEqual(20);

    const pageTwo = accountConnectorService.getCatalog({
      category: 'work management',
      limit: 3,
      offset: 3
    });
    expect(pageTwo.offset).toBe(3);
    expect(pageTwo.limit).toBe(3);
    expect(pageTwo.total).toBe(aliasResult.total);
    expect(pageTwo.connectors).toHaveLength(3);
    expect(pageTwo.connectors[0]).not.toMatchObject(aliasResult.connectors[0]);
  });

  test('decrypts connector credentials only for in-process sync and redacts private account metadata', () => {
    const originalEncryptionKey = process.env.CONNECTOR_ENCRYPTION_KEY;
    process.env.CONNECTOR_ENCRYPTION_KEY = 'connector-encryption-key-for-security-tests-123456';

    try {
      const encryptedToken = accountConnectorService.encrypt('github-token-value');
      const credentials = accountConnectorService.getAccountCredentials({
        credentials: { accessToken: encryptedToken }
      });
      const account = accountConnectorService.sanitizeAccount({
        _id: 'account-1',
        workspaceId: 'workspace-1',
        connectorId: 'github',
        connectorName: 'GitHub',
        category: 'software_delivery',
        authType: 'oauth2',
        status: 'connected',
        credentials: { accessToken: encryptedToken },
        metadata: {
          workSignalCursor: '2026-07-10T00:00:00.000Z',
          syncRecords: [{ title: 'Private issue payload' }],
          lastWorkSignalSync: {
            source: 'github_api',
            signalCount: 4,
            finishedAt: new Date('2026-07-10T00:00:00Z')
          }
        }
      });

      expect(credentials).toEqual({ accessToken: 'github-token-value' });
      expect(account).not.toHaveProperty('credentials');
      expect(account.metadata).toMatchObject({
        lastWorkSignalSync: { source: 'github_api', signalCount: 4 }
      });
      expect(account.metadata).not.toHaveProperty('workSignalCursor');
      expect(account.metadata).not.toHaveProperty('syncRecords');
    } finally {
      if (originalEncryptionKey === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY;
      else process.env.CONNECTOR_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  test('lists Jira sites with an in-process token and persists only the selected cloud ID', async () => {
    const originalEncryptionKey = process.env.CONNECTOR_ENCRYPTION_KEY;
    process.env.CONNECTOR_ENCRYPTION_KEY = 'connector-encryption-key-for-security-tests-123456';
    const originalHttp = accountConnectorService.http;
    const get = jest.fn().mockResolvedValue({
      data: [
        { id: 'cloud-0001', name: 'Delivery', url: 'https://delivery.atlassian.net', scopes: ['read:jira-work'] },
        { id: 'cloud-0002', name: 'Knowledge', url: 'https://knowledge.atlassian.net', scopes: ['read:confluence-content.all'] }
      ]
    });
    accountConnectorService.http = { get };
    const account = {
      _id: 'account-1',
      workspaceId: 'workspace-1',
      connectorId: 'jira_software',
      connectorName: 'Jira Software',
      category: 'software_delivery',
      authType: 'oauth2',
      status: 'failed',
      credentials: { accessToken: accountConnectorService.encrypt('jira-token-value') },
      metadata: { fields: {} },
      save: jest.fn().mockResolvedValue(undefined)
    };
    const accountSpy = jest.spyOn(accountConnectorService, 'getManagedAccount').mockResolvedValue(account);

    try {
      const sites = await accountConnectorService.getJiraSites('account-1', { workspaceId: 'workspace-1' });
      expect(sites).toEqual([{ cloudId: 'cloud-0001', name: 'Delivery', url: 'https://delivery.atlassian.net' }]);
      expect(get).toHaveBeenCalledWith(
        'https://api.atlassian.com/oauth/token/accessible-resources',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer jira-token-value' }) })
      );

      const selected = await accountConnectorService.selectJiraSite('account-1', 'cloud-0001', { workspaceId: 'workspace-1' });
      expect(account.metadata.fields).toEqual({ cloudId: 'cloud-0001' });
      expect(account.save).toHaveBeenCalledTimes(1);
      expect(selected.metadata.fields).toEqual({ cloudId: 'cloud-0001' });
      expect(selected).not.toHaveProperty('credentials');
    } finally {
      accountSpy.mockRestore();
      accountConnectorService.http = originalHttp;
      if (originalEncryptionKey === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY;
      else process.env.CONNECTOR_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });
});

describe('work signal normalization', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.dontMock('mongoose');
    jest.dontMock('../src/services/workspaceScopeService');
    jest.dontMock('../src/models/WorkActor');
    jest.dontMock('../src/models/WorkComment');
    jest.dontMock('../src/models/WorkContainer');
    jest.dontMock('../src/models/WorkDependency');
    jest.dontMock('../src/models/WorkEvent');
    jest.dontMock('../src/models/WorkItem');
    jest.dontMock('../src/models/Recommendation');
    jest.dontMock('../src/services/githubWorkSignalClient');
    jest.dontMock('../src/services/trelloWorkSignalClient');
    jest.dontMock('../src/services/jiraWorkSignalClient');
    jest.resetModules();
  });

  test('defines adapter contracts and normalizes provider payloads into WorkSignal fields', () => {
    const workSignalService = require('../src/services/workSignalService');
    const workspaceId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();
    const account = {
      _id: accountId,
      workspaceId,
      connectorId: 'github'
    };

    const normalized = workSignalService.normalizeSignalPayload(account, {
      id: 'issue-42',
      summary: 'Fix webhook retry leak',
      type: 'bug',
      state: 'closed',
      severity: 'urgent',
      assignees: ['Ana', 'Robert'],
      tags: ['backend', 'webhooks'],
      htmlUrl: 'https://github.example/issues/42',
      due: '2026-07-01T10:00:00Z'
    });
    const contract = workSignalService.buildAdapterContract('github');
    const trelloContract = workSignalService.buildAdapterContract('trello');
    const notionContract = workSignalService.buildAdapterContract('notion');

    expect(String(normalized.workspaceId)).toBe(String(workspaceId));
    expect(String(normalized.connectorAccountId)).toBe(String(accountId));
    expect(normalized).toMatchObject({
      provider: 'github',
      externalId: 'issue-42',
      sourceType: 'issue',
      title: 'Fix webhook retry leak',
      status: 'done',
      priority: 'critical',
      owners: ['Ana', 'Robert'],
      labels: ['backend', 'webhooks'],
      url: 'https://github.example/issues/42'
    });
    expect(normalized.dueAt.toISOString()).toBe('2026-07-01T10:00:00.000Z');
    expect(contract).toMatchObject({
      connectorId: 'github',
      adapterStatus: 'implemented',
      outputModel: 'WorkSignal',
      requiredFields: ['externalId', 'title']
    });
    expect(trelloContract.adapterCapabilities).toMatchObject({
      list: true,
      fetchDelta: true,
      normalize: true,
      applyAction: false
    });
    expect(notionContract.adapterStatus).toBe('contract_only');
    expect(workSignalService.getAdapterContracts()).toHaveLength(getConnectors().length);
  });

  test('first-wave provider adapters normalize records and block external writes', async () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const workspaceId = new mongoose.Types.ObjectId();
    const account = {
      _id: new mongoose.Types.ObjectId(),
      workspaceId,
      connectorId: 'github'
    };

    const normalized = workSignalAdapterService.normalize(account, {
      node_id: 'PR_kwDO123',
      title: 'Ship connector sync worker',
      body: 'Adds first-wave provider ingestion.',
      state: 'open',
      pull_request: {},
      labels: [{ name: 'P1' }, { name: 'backend' }],
      assignees: [{ login: 'robert' }],
      html_url: 'https://github.example/pull/7',
      created_at: '2026-06-30T07:00:00Z',
      updated_at: '2026-06-30T08:00:00Z'
    });

    expect(workSignalAdapterService.getFirstWaveConnectorIds()).toEqual(expect.arrayContaining([
      'trello',
      'jira_software',
      'asana',
      'slack',
      'github',
      'google_workspace',
      'microsoft_365'
    ]));
    expect(workSignalAdapterService.listAdapters().length).toBeGreaterThanOrEqual(8);
    expect(normalized).toMatchObject({
      externalId: 'PR_kwDO123',
      sourceType: 'pull_request',
      title: 'Ship connector sync worker',
      status: 'open',
      priority: 'high',
      owners: ['robert'],
      labels: ['P1', 'backend'],
      url: 'https://github.example/pull/7'
    });
    await expect(workSignalAdapterService.applyAction(account, {
      type: 'comment'
    })).rejects.toThrow('read-only');
  });

  test('GitHub adapter delegates live delta reads to its credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ node_id: 'ISSUE_1' }] });
    jest.doMock('../src/services/githubWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'github' };

    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('github').capabilities.credentialBackedSync).toBe(true);
  });

  test('Trello adapter delegates live delta reads to its credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'card-1' }] });
    jest.doMock('../src/services/trelloWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'trello' };

    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('trello').capabilities.credentialBackedSync).toBe(true);
  });

  test('Jira adapters delegate live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'issue-1' }] });
    jest.doMock('../src/services/jiraWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'jira_software' };

    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('jira_software').capabilities.credentialBackedSync).toBe(true);
    expect(workSignalAdapterService.getAdapter('jira_service_management').capabilities.credentialBackedSync).toBe(true);
  });

  test('GitHub API sync stays read-only, bounded, and cursor-safe', async () => {
    const { GitHubWorkSignalClient } = require('../src/services/githubWorkSignalClient');
    const http = {
      get: jest.fn()
        .mockResolvedValueOnce({
          data: [{
            id: 7,
            node_id: 'R_7',
            full_name: 'Noodzakelijk-Online/sneup',
            html_url: 'https://github.com/Noodzakelijk-Online/sneup',
            owner: { login: 'Noodzakelijk-Online' }
          }],
          headers: {}
        })
        .mockResolvedValueOnce({
          data: [{
            node_id: 'PR_9',
            title: 'Ship live connector sync',
            pull_request: {},
            state: 'open',
            updated_at: '2026-07-09T12:00:00Z'
          }],
          headers: {}
        })
    };
    const credentials = { getAccountCredentials: jest.fn(() => ({ accessToken: 'test-token' })) };
    const client = new GitHubWorkSignalClient({ http, accountConnectorService: credentials });
    const originalEnv = { ...process.env };
    process.env.SNEUP_GITHUB_MAX_REPOSITORIES = '3';
    process.env.SNEUP_GITHUB_MAX_ITEMS_PER_REPOSITORY = '100';
    process.env.SNEUP_GITHUB_MAX_TOTAL_ITEMS = '100';
    process.env.SNEUP_GITHUB_CURSOR_LOOKBACK_MS = '60000';

    try {
      const result = await client.fetchDelta({ connectorId: 'github' }, '2026-07-09T11:30:00.000Z');

      expect(http.get).toHaveBeenCalledTimes(2);
      expect(http.get.mock.calls[0][0]).toBe('https://api.github.com/user/repos');
      expect(http.get.mock.calls[1][0]).toBe('https://api.github.com/repos/Noodzakelijk-Online/sneup/issues');
      expect(http.get.mock.calls[1][1].params.since).toBe('2026-07-09T11:29:00.000Z');
      expect(http.get.mock.calls[1][1].headers.Authorization).toBe('Bearer test-token');
      expect(result).toMatchObject({
        nextCursor: '2026-07-09T12:00:00.000Z',
        hasMore: false,
        metadata: { source: 'github_api', repositories: 1 }
      });
      expect(result.records[0]).toMatchObject({
        node_id: 'PR_9',
        repository: { full_name: 'Noodzakelijk-Online/sneup' }
      });
    } finally {
      process.env = originalEnv;
    }
  });

  test('Trello API sync uses linked credentials with bounded read-only board and card requests', async () => {
    const { TrelloWorkSignalClient } = require('../src/services/trelloWorkSignalClient');
    const http = {
      get: jest.fn()
        .mockResolvedValueOnce({
          data: [{
            id: 'board-1',
            name: 'Client Launch',
            url: 'https://trello.com/b/board-1/client-launch'
          }]
        })
        .mockResolvedValueOnce({
          data: [{
            id: 'card-1',
            name: 'Confirm launch approval',
            dateLastActivity: '2026-07-09T12:00:00Z',
            labels: [{ name: 'P1' }],
            members: [{ username: 'robert' }]
          }]
        })
    };
    const credentials = {
      getAccountCredentials: jest.fn(() => ({ apiKey: 'test-key', apiToken: 'test-token' }))
    };
    const client = new TrelloWorkSignalClient({ http, accountConnectorService: credentials });
    const originalEnv = { ...process.env };
    process.env.SNEUP_TRELLO_MAX_BOARDS = '3';
    process.env.SNEUP_TRELLO_MAX_CARDS_PER_BOARD = '100';
    process.env.SNEUP_TRELLO_MAX_TOTAL_CARDS = '100';
    process.env.SNEUP_TRELLO_CURSOR_LOOKBACK_MS = '60000';

    try {
      const result = await client.fetchDelta({ connectorId: 'trello' }, '2026-07-09T11:30:00.000Z');

      expect(http.get).toHaveBeenCalledTimes(2);
      expect(http.get.mock.calls[0][0]).toBe('https://api.trello.com/1/members/me/boards');
      expect(http.get.mock.calls[1][0]).toBe('https://api.trello.com/1/boards/board-1/cards');
      expect(http.get.mock.calls[1][1].params).toMatchObject({
        key: 'test-key',
        token: 'test-token',
        limit: 100,
        filter: 'all'
      });
      expect(result).toMatchObject({
        nextCursor: '2026-07-09T12:00:00.000Z',
        hasMore: false,
        metadata: { source: 'trello_api', boards: 1 }
      });
      expect(result.records[0]).toMatchObject({
        id: 'card-1',
        board: { id: 'board-1', name: 'Client Launch' }
      });
    } finally {
      process.env = originalEnv;
    }
  });

  test('Jira API sync discovers one authorized site and reads bounded issue pages', async () => {
    const { JiraWorkSignalClient } = require('../src/services/jiraWorkSignalClient');
    const http = {
      get: jest.fn().mockResolvedValue({
        data: [{
          id: 'cloud-1',
          name: 'Delivery',
          url: 'https://delivery.atlassian.net',
          scopes: ['read:jira-work', 'read:jira-user']
        }]
      }),
      post: jest.fn().mockResolvedValue({
        data: {
          issues: [{
            id: '1001',
            key: 'DEL-12',
            fields: {
              summary: 'Confirm release owner',
              updated: '2026-07-09T12:00:00.000Z',
              project: { key: 'DEL', name: 'Delivery' }
            }
          }]
        }
      })
    };
    const credentials = {
      getAccountCredentials: jest.fn(() => ({ accessToken: 'jira-access-token' }))
    };
    const client = new JiraWorkSignalClient({ http, accountConnectorService: credentials });
    const originalEnv = { ...process.env };
    process.env.SNEUP_JIRA_MAX_ISSUES = '100';
    process.env.SNEUP_JIRA_PAGE_SIZE = '50';
    process.env.SNEUP_JIRA_CURSOR_LOOKBACK_MS = '60000';

    try {
      const result = await client.fetchDelta({ connectorId: 'jira_software' }, '2026-07-09T11:30:00.000Z');

      expect(http.get).toHaveBeenCalledWith(
        'https://api.atlassian.com/oauth/token/accessible-resources',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer jira-access-token' })
        })
      );
      expect(http.post).toHaveBeenCalledWith(
        'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/search/jql',
        expect.objectContaining({
          maxResults: 50,
          jql: expect.stringContaining('updated >= "2026-07-09 11:29"')
        }),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer jira-access-token' })
        })
      );
      expect(result).toMatchObject({
        nextCursor: '2026-07-09T12:00:00.000Z',
        hasMore: false,
        metadata: { source: 'jira_api', sites: 1, cloudId: 'cloud-1' }
      });
      expect(result.records[0]).toMatchObject({
        key: 'DEL-12',
        url: 'https://delivery.atlassian.net/browse/DEL-12',
        site: { id: 'cloud-1', name: 'Delivery' }
      });
    } finally {
      process.env = originalEnv;
    }
  });

  test('Jira sync rejects ambiguous multi-site access instead of choosing a workspace', () => {
    const { JiraWorkSignalClient } = require('../src/services/jiraWorkSignalClient');
    const client = new JiraWorkSignalClient({ accountConnectorService: {} });

    expect(() => client.selectResource({}, [
      { id: 'cloud-1', name: 'One' },
      { id: 'cloud-2', name: 'Two' }
    ])).toThrow('multiple sites');
    try {
      client.selectResource({}, [{ id: 'cloud-1' }, { id: 'cloud-2' }]);
    } catch (error) {
      expect(error.statusCode).toBe(409);
    }
  });

  test('projects provider signals into normalized work graph records', () => {
    const WorkActor = require('../src/models/WorkActor');
    const WorkComment = require('../src/models/WorkComment');
    const WorkContainer = require('../src/models/WorkContainer');
    const WorkDependency = require('../src/models/WorkDependency');
    const WorkEvent = require('../src/models/WorkEvent');
    const WorkItem = require('../src/models/WorkItem');
    const Recommendation = require('../src/models/Recommendation');
    const workGraphService = require('../src/services/workGraphService');
    const workspaceId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();
    const signalId = new mongoose.Types.ObjectId();

    const projection = workGraphService.buildProjection({
      _id: signalId,
      workspaceId,
      connectorAccountId: accountId,
      provider: 'github',
      externalId: 'PR_kwDO123',
      sourceType: 'pull_request',
      title: 'Ship graph-backed provider sync',
      description: 'Cross-tool work item projection',
      status: 'open',
      priority: 'high',
      url: 'https://github.example/pull/8',
      owners: ['Robert Velhorst'],
      labels: ['P1', 'backend'],
      providerCreatedAt: new Date('2026-06-30T07:00:00Z'),
      providerUpdatedAt: new Date('2026-06-30T08:00:00Z'),
      evidenceRefs: [{ type: 'pull_request', label: 'PR 8' }],
      raw: {
        repository: {
          id: 'repo-1',
          full_name: 'no/sneup'
        },
        blockedBy: [{ node_id: 'ISSUE_kwDO999', title: 'Complete auth review' }]
      }
    });

    expect(WorkItem.schema.path('canonicalKey')).toBeTruthy();
    expect(WorkActor.schema.path('displayName')).toBeTruthy();
    expect(WorkContainer.schema.path('containerType').enumValues).toContain('repository');
    expect(WorkComment.schema.path('body')).toBeTruthy();
    expect(WorkDependency.schema.path('dependencyType').enumValues).toContain('blocks');
    expect(WorkEvent.schema.path('eventKey')).toBeTruthy();
    expect(Recommendation.schema.path('sourceEvidence').schema.path('type').enumValues).toEqual(expect.arrayContaining([
      'work_item',
      'work_graph'
    ]));
    expect(projection).toMatchObject({
      sourceProvider: 'github',
      externalId: 'PR_kwDO123',
      canonicalKey: 'github:PR_kwDO123',
      title: 'Ship graph-backed provider sync',
      itemType: 'pull_request',
      status: 'open',
      priority: 'high',
      ownerKeys: ['github:actor:robert-velhorst'],
      labelKeys: ['p1', 'backend'],
      containerKey: 'github:container:repo-1',
      container: expect.objectContaining({
        name: 'no/sneup',
        containerType: 'repository'
      }),
      dependencies: [
        expect.objectContaining({
          sourceProvider: 'github',
          sourceExternalId: 'PR_kwDO123',
          targetProvider: 'github',
          targetExternalId: 'ISSUE_kwDO999',
          dependencyType: 'blocked_by'
        })
      ],
      event: expect.objectContaining({
        eventType: 'synced',
        eventKey: 'github:PR_kwDO123:2026-06-30T08:00:00.000Z'
      })
    });
    expect(String(projection.workspaceId)).toBe(String(workspaceId));
    expect(String(projection.connectorAccountId)).toBe(String(accountId));
    expect(String(projection.sourceSignalId)).toBe(String(signalId));
  });

  test('persists unresolved cross-provider dependencies from synced work signals', async () => {
    jest.resetModules();

    const workspaceId = 'workspace-object-id';
    const sourceItem = {
      _id: 'item-source',
      workspaceId,
      sourceProvider: 'jira_software',
      connectorAccountId: 'account-1',
      sourceSignalId: 'signal-1',
      externalId: 'OPS-42',
      canonicalKey: 'jira_software:OPS-42',
      title: 'Launch blocker',
      description: 'Waiting on GitHub implementation.',
      itemType: 'issue',
      status: 'blocked',
      priority: 'high',
      url: 'https://jira.example/browse/OPS-42',
      ownerKeys: [],
      labelKeys: [],
      evidenceRefs: [],
      syncState: {},
      firstSeenAt: new Date('2026-06-30T08:00:00Z'),
      lastSeenAt: new Date('2026-06-30T08:00:00Z')
    };
    const findOneAndUpdateDependency = jest.fn().mockResolvedValue({ _id: 'dep-1' });
    const resolvePending = jest.fn().mockResolvedValue({ modifiedCount: 0 });

    jest.doMock('mongoose', () => ({ connection: { readyState: 1 } }));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn(() => workspaceId),
      getDefaultWorkspaceObjectId: jest.fn(() => workspaceId)
    }));
    jest.doMock('../src/models/WorkItem', () => ({
      itemTypes: ['task', 'project', 'message', 'issue', 'pull_request', 'document', 'event', 'risk', 'decision', 'other'],
      findOneAndUpdate: jest.fn().mockResolvedValue(sourceItem),
      findOne: jest.fn().mockResolvedValue(null)
    }));
    jest.doMock('../src/models/WorkActor', () => ({ findOneAndUpdate: jest.fn().mockResolvedValue({}) }));
    jest.doMock('../src/models/WorkComment', () => ({ findOneAndUpdate: jest.fn().mockResolvedValue({}) }));
    jest.doMock('../src/models/WorkContainer', () => ({ findOneAndUpdate: jest.fn().mockResolvedValue({}) }));
    jest.doMock('../src/models/WorkEvent', () => ({ findOneAndUpdate: jest.fn().mockResolvedValue({}) }));
    jest.doMock('../src/models/WorkDependency', () => ({
      findOneAndUpdate: findOneAndUpdateDependency,
      updateMany: resolvePending
    }));
    jest.doMock('../src/models/Recommendation', () => ({}));

    const workGraphService = require('../src/services/workGraphService');
    await workGraphService.upsertFromSignal({
      _id: 'signal-1',
      workspaceId,
      connectorAccountId: 'account-1',
      provider: 'jira_software',
      externalId: 'OPS-42',
      sourceType: 'issue',
      title: 'Launch blocker',
      description: 'Waiting on GitHub implementation.',
      status: 'blocked',
      priority: 'high',
      url: 'https://jira.example/browse/OPS-42',
      raw: {
        blockedBy: [{
          provider: 'github',
          node_id: 'ISSUE_kwDO999',
          title: 'Implement launch API',
          html_url: 'https://github.example/issues/999'
        }]
      }
    }, { actorId: 'sync-test' });

    expect(findOneAndUpdateDependency).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        sourceProvider: 'jira_software',
        externalId: 'jira_software:OPS-42:blockedBy:0:github:ISSUE_kwDO999'
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          sourceItemId: 'item-source',
          sourceExternalId: 'OPS-42',
          targetProvider: 'github',
          targetExternalId: 'ISSUE_kwDO999',
          targetTitle: 'Implement launch API',
          targetUrl: 'https://github.example/issues/999',
          resolutionStatus: 'unresolved',
          freshnessStatus: 'fresh',
          lastSeenAt: expect.any(Date),
          dependencyType: 'blocked_by'
        }),
        $unset: expect.objectContaining({ targetItemId: '' })
      }),
      expect.objectContaining({
        upsert: true
      })
    );
    expect(resolvePending).toHaveBeenCalledWith(
      expect.objectContaining({
        targetProvider: 'jira_software',
        targetExternalId: 'OPS-42',
        resolutionStatus: 'unresolved'
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          targetItemId: 'item-source',
          resolutionStatus: 'resolved'
        })
      })
    );
    expect(resolvePending).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        freshnessStatus: { $ne: 'stale' }
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          freshnessStatus: 'stale',
          staleReason: expect.stringContaining('not been observed')
        })
      })
    );
  });

  test('reviews stale graph dependencies without external provider writes', async () => {
    jest.resetModules();

    const workspaceId = 'workspace-object-id';
    const staleDependency = {
      _id: 'dep-1',
      workspaceId,
      sourceItemId: 'item-source',
      targetItemId: 'item-target',
      sourceProvider: 'jira_software',
      sourceExternalId: 'OPS-42',
      targetProvider: 'github',
      targetExternalId: 'ISSUE_kwDO999',
      dependencyType: 'blocked_by',
      externalId: 'jira_software:OPS-42:blockedBy:0:github:ISSUE_kwDO999',
      freshnessStatus: 'stale',
      reviewStatus: 'unreviewed',
      staleSince: new Date('2026-06-01T08:00:00Z'),
      staleReason: 'Provider dependency link has not been observed during recent syncs.',
      confidence: 0.6,
      metadata: {}
    };
    const findOneAndUpdateDependency = jest.fn().mockImplementation((query, update) => Promise.resolve({
      ...staleDependency,
      ...update.$set,
      metadata: {
        ...staleDependency.metadata,
        ...Object.fromEntries(Object.entries(update.$set || {})
          .filter(([key]) => key.startsWith('metadata.'))
          .map(([key, value]) => [key.replace('metadata.', ''), value]))
      }
    }));

    jest.doMock('mongoose', () => ({ connection: { readyState: 1 } }));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn(() => workspaceId),
      getDefaultWorkspaceObjectId: jest.fn(() => workspaceId)
    }));
    jest.doMock('../src/models/WorkDependency', () => ({
      findOne: jest.fn().mockResolvedValue(staleDependency),
      findOneAndUpdate: findOneAndUpdateDependency
    }));
    jest.doMock('../src/models/WorkActor', () => ({}));
    jest.doMock('../src/models/WorkComment', () => ({}));
    jest.doMock('../src/models/WorkContainer', () => ({}));
    jest.doMock('../src/models/WorkEvent', () => ({}));
    jest.doMock('../src/models/WorkItem', () => ({}));
    jest.doMock('../src/models/Recommendation', () => ({}));

    const workGraphService = require('../src/services/workGraphService');
    const dismissed = await workGraphService.reviewDependency('dep-1', {
      workspaceId,
      actorId: 'robert',
      action: 'dismiss',
      reason: 'GitHub issue was closed outside Sneup.'
    });

    expect(findOneAndUpdateDependency).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'dep-1', workspaceId }),
      expect.objectContaining({
        $set: expect.objectContaining({
          reviewedBy: 'robert',
          reviewStatus: 'dismissed',
          freshnessStatus: 'stale',
          confidence: 0,
          staleReason: 'GitHub issue was closed outside Sneup.'
        })
      }),
      expect.objectContaining({ new: true })
    );
    expect(dismissed).toMatchObject({
      id: 'dep-1',
      freshnessStatus: 'stale',
      reviewStatus: 'dismissed',
      reviewedBy: 'robert',
      confidence: 0
    });

    await expect(workGraphService.reviewDependency('dep-1', {
      workspaceId,
      action: 'delete'
    })).rejects.toThrow('confirm, dismiss, or refresh');
  });

  test('summarizes stale-edge review outcomes and connector quality without provider writes', async () => {
    jest.resetModules();

    const workspaceId = 'workspace-object-id';
    const chain = (items) => {
      const query = {
        sort: jest.fn(() => query),
        limit: jest.fn().mockResolvedValue(items)
      };
      return query;
    };
    const dependencyAggregate = jest.fn()
      .mockResolvedValueOnce([{ _id: 'blocks', count: 8 }])
      .mockResolvedValueOnce([{ _id: 'fresh', count: 8 }, { _id: 'stale', count: 4 }])
      .mockResolvedValueOnce([
        { _id: 'unreviewed', count: 9 },
        { _id: 'confirmed', count: 1 },
        { _id: 'refreshed', count: 1 },
        { _id: 'dismissed', count: 1 }
      ])
      .mockResolvedValueOnce([
        { _id: 'jira_software', dependencies: 7, stale: 3, staleUnreviewed: 2, confirmed: 1, refreshed: 0, dismissed: 0 },
        { _id: 'github', dependencies: 5, stale: 1, staleUnreviewed: 1, confirmed: 0, refreshed: 1, dismissed: 1 }
      ]);

    jest.doMock('mongoose', () => ({ connection: { readyState: 1 } }));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn(() => workspaceId),
      getDefaultWorkspaceObjectId: jest.fn(() => workspaceId)
    }));
    jest.doMock('../src/models/WorkItem', () => ({
      countDocuments: jest.fn().mockResolvedValue(6),
      aggregate: jest.fn()
        .mockResolvedValueOnce([{ _id: 'open', count: 4 }])
        .mockResolvedValueOnce([{ _id: 'jira_software', count: 4 }]),
      find: jest.fn(() => chain([]))
    }));
    jest.doMock('../src/models/WorkActor', () => ({ countDocuments: jest.fn().mockResolvedValue(2) }));
    jest.doMock('../src/models/WorkComment', () => ({ countDocuments: jest.fn().mockResolvedValue(3) }));
    jest.doMock('../src/models/WorkContainer', () => ({ countDocuments: jest.fn().mockResolvedValue(2) }));
    jest.doMock('../src/models/WorkEvent', () => ({ countDocuments: jest.fn().mockResolvedValue(5) }));
    jest.doMock('../src/models/WorkDependency', () => ({
      countDocuments: jest.fn().mockResolvedValue(12),
      aggregate: dependencyAggregate,
      find: jest.fn(() => chain([]))
    }));
    jest.doMock('../src/models/Recommendation', () => ({}));

    const workGraphService = require('../src/services/workGraphService');
    const summary = await workGraphService.getSummary({ workspaceId: 'tenant-a' });

    expect(summary).toMatchObject({
      byDependencyFreshness: { fresh: 8, stale: 4 },
      byDependencyReviewStatus: { unreviewed: 9, confirmed: 1, refreshed: 1, dismissed: 1 },
      reviewMetrics: {
        stale: 4,
        pendingReview: 3,
        reviewed: 3,
        reviewCoverage: 50
      }
    });
    expect(summary.providerReviewQuality).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'jira_software',
        stale: 3,
        pendingReview: 2,
        reviewCoverage: 33,
        status: 'needs_review'
      }),
      expect.objectContaining({
        provider: 'github',
        stale: 1,
        pendingReview: 1,
        dismissed: 1,
        status: 'needs_review'
      })
    ]));
    expect(dependencyAggregate).toHaveBeenCalledTimes(4);
  });

  test('extracts provider-native work dependencies into graph projections', () => {
    const workGraphService = require('../src/services/workGraphService');
    const workspaceId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();

    const jiraProjection = workGraphService.buildProjection({
      workspaceId,
      connectorAccountId: accountId,
      provider: 'jira_software',
      externalId: 'OPS-42',
      sourceType: 'issue',
      title: 'Launch checklist',
      status: 'blocked',
      raw: {
        fields: {
          issuelinks: [
            {
              id: '1001',
              type: { outward: 'blocks', inward: 'is blocked by' },
              outwardIssue: { key: 'OPS-43', fields: { summary: 'Launch QA' } }
            },
            {
              id: '1002',
              type: { inward: 'is blocked by' },
              inwardIssue: { key: 'OPS-7', fields: { summary: 'Client approval' } }
            }
          ]
        }
      }
    });
    const asanaProjection = workGraphService.buildProjection({
      workspaceId,
      connectorAccountId: accountId,
      provider: 'asana',
      externalId: 'task-1',
      sourceType: 'task',
      title: 'Publish landing page',
      status: 'waiting',
      raw: {
        dependencies: [{ gid: 'task-0', name: 'Approve copy' }],
        dependents: [{ gid: 'task-2', name: 'Start ads' }]
      }
    });
    const githubProjection = workGraphService.buildProjection({
      workspaceId,
      connectorAccountId: accountId,
      provider: 'github',
      externalId: 'PR_kwDO1',
      sourceType: 'pull_request',
      title: 'Ship reporting API',
      status: 'open',
      raw: {
        blocks: [{ node_id: 'ISSUE_kwDO2', title: 'Frontend report UI' }],
        closing_issues: [{ node_id: 'ISSUE_kwDO3', title: 'Bug report' }]
      }
    });
    const trelloProjection = workGraphService.buildProjection({
      workspaceId,
      connectorAccountId: accountId,
      provider: 'trello',
      externalId: 'card-1',
      sourceType: 'task',
      title: 'Client rollout',
      status: 'open',
      raw: {
        attachments: [
          { id: 'attachment-1', idModel: 'card-2', name: 'Related rollout checklist', url: 'https://trello.example/c/card-2' }
        ]
      }
    });

    expect(jiraProjection.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetExternalId: 'OPS-43',
        dependencyType: 'blocks',
        sourceProvider: 'jira_software'
      }),
      expect.objectContaining({
        targetExternalId: 'OPS-7',
        dependencyType: 'blocked_by',
        sourceProvider: 'jira_software'
      })
    ]));
    expect(asanaProjection.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetExternalId: 'task-0',
        dependencyType: 'depends_on',
        sourceProvider: 'asana'
      }),
      expect.objectContaining({
        targetExternalId: 'task-2',
        dependencyType: 'blocks',
        sourceProvider: 'asana'
      })
    ]));
    expect(githubProjection.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetExternalId: 'ISSUE_kwDO2',
        dependencyType: 'blocks',
        sourceProvider: 'github'
      }),
      expect.objectContaining({
        targetExternalId: 'ISSUE_kwDO3',
        dependencyType: 'relates_to',
        sourceProvider: 'github'
      })
    ]));
    expect(trelloProjection.dependencies).toEqual([
      expect.objectContaining({
        targetExternalId: 'card-2',
        dependencyType: 'relates_to',
        sourceProvider: 'trello'
      })
    ]);
  });

  test('routes graph work items into Robert, VA, and team decision candidates without provider writes', () => {
    const workGraphService = require('../src/services/workGraphService');
    const workspaceId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();

    const blocked = workGraphService.buildDecisionCandidate({
      _id: new mongoose.Types.ObjectId(),
      workspaceId,
      connectorAccountId: accountId,
      sourceProvider: 'jira_software',
      externalId: 'OPS-42',
      canonicalKey: 'jira_software:OPS-42',
      title: 'Client launch blocker',
      description: 'Waiting on client approval',
      itemType: 'issue',
      status: 'blocked',
      priority: 'high',
      ownerKeys: ['jira_software:actor:nina'],
      labelKeys: ['client'],
      url: 'https://jira.example/browse/OPS-42',
      lastSeenAt: new Date('2026-06-30T08:00:00Z')
    }, {
      dependencyCount: 3,
      blockingCount: 1,
      blockedByCount: 2,
      dependencyTypes: {
        blocks: 1,
        blocked_by: 2
      }
    });
    const ownerless = workGraphService.buildDecisionCandidate({
      _id: new mongoose.Types.ObjectId(),
      workspaceId,
      connectorAccountId: accountId,
      sourceProvider: 'asana',
      externalId: 'task-77',
      canonicalKey: 'asana:task-77',
      title: 'Prepare QA checklist',
      itemType: 'task',
      status: 'open',
      priority: 'normal',
      ownerKeys: [],
      labelKeys: ['qa'],
      lastSeenAt: new Date('2026-06-30T08:00:00Z')
    });
    const sensitive = workGraphService.buildDecisionCandidate({
      _id: new mongoose.Types.ObjectId(),
      workspaceId,
      connectorAccountId: accountId,
      sourceProvider: 'microsoft_365',
      externalId: 'mail-9',
      canonicalKey: 'microsoft_365:mail-9',
      title: 'Client contract budget approval',
      itemType: 'message',
      status: 'open',
      priority: 'normal',
      ownerKeys: ['microsoft_365:actor:ana'],
      labelKeys: ['contract'],
      lastSeenAt: new Date('2026-06-30T08:00:00Z')
    });
    const staleDependencyReview = workGraphService.buildDecisionCandidate({
      _id: new mongoose.Types.ObjectId(),
      workspaceId,
      connectorAccountId: accountId,
      sourceProvider: 'jira_software',
      externalId: 'OPS-99',
      canonicalKey: 'jira_software:OPS-99',
      title: 'Review old provider blocker',
      itemType: 'issue',
      status: 'blocked',
      priority: 'normal',
      ownerKeys: ['jira_software:actor:nina'],
      labelKeys: [],
      lastSeenAt: new Date('2026-06-30T08:00:00Z')
    }, {
      dependencyCount: 2,
      activeDependencyCount: 0,
      staleDependencyCount: 2,
      blockingCount: 0,
      blockedByCount: 0,
      dependencyTypes: {
        blocked_by: 2
      }
    });

    expect(blocked).toMatchObject({
      findingType: 'graph_blocked_work',
      ownerType: 'robert',
      actionType: 'escalate',
      riskLevel: 'high',
      requiresApproval: true,
      dependencySummary: expect.objectContaining({
        blockingCount: 1,
        blockedByCount: 2
      }),
      actionPayload: expect.objectContaining({
        dependencySummary: expect.objectContaining({
          blockedByCount: 2
        })
      })
    });
    expect(blocked.graphScore).toBeGreaterThan(ownerless.graphScore);
    expect(blocked.approvalReason).toContain('blocked by 2 graph dependencies');
    expect(blocked.sourceEvidence[0].data.dependencySummary).toMatchObject({
      dependencyCount: 3
    });
    expect(ownerless).toMatchObject({
      findingType: 'graph_unowned_work',
      ownerType: 'va',
      actionType: 'reassign',
      riskLevel: 'medium'
    });
    expect(sensitive).toMatchObject({
      findingType: 'graph_robert_review',
      ownerType: 'robert',
      actionType: 'manual_review'
    });
    expect(staleDependencyReview).toMatchObject({
      dependencySummary: expect.objectContaining({
        dependencyCount: 2,
        activeDependencyCount: 0,
        staleDependencyCount: 2,
        blockedByCount: 0
      })
    });
    expect(staleDependencyReview.approvalReason).toContain('stale graph dependencies need review');
    expect(staleDependencyReview.graphScore).toBeLessThan(blocked.graphScore);
    expect([blocked, ownerless, sensitive].every(candidate =>
      candidate.actionPayload.externalProviderWriteBlocked === true
      && candidate.actionPayload.executable === false
      && candidate.sourceEvidence[0].type === 'work_item'
    )).toBe(true);
  });
});

describe('work graph drilldowns', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.dontMock('mongoose');
    jest.dontMock('../src/services/workspaceScopeService');
    jest.dontMock('../src/models/WorkActor');
    jest.dontMock('../src/models/WorkContainer');
    jest.dontMock('../src/models/WorkDependency');
    jest.dontMock('../src/models/WorkEvent');
    jest.dontMock('../src/models/WorkItem');
    jest.dontMock('../src/models/Recommendation');
    jest.dontMock('../src/models/DecisionQueueItem');
    jest.dontMock('../src/models/AuditEvent');
    jest.dontMock('../src/models/Board');
    jest.dontMock('../src/services/interventionPolicy');
    jest.resetModules();
  });

  test('returns source item, dependency edges, and queued recommendation history for graph item detail', async () => {
    jest.resetModules();

    const item = {
      _id: 'item-1',
      workspaceId: 'workspace-object-id',
      sourceProvider: 'jira_software',
      connectorAccountId: 'account-1',
      sourceSignalId: 'signal-1',
      externalId: 'OPS-42',
      canonicalKey: 'jira_software:OPS-42',
      title: 'Client launch blocker',
      description: 'Waiting on client approval',
      itemType: 'issue',
      status: 'blocked',
      priority: 'high',
      ownerKeys: ['jira_software:actor:nina'],
      labelKeys: ['client'],
      containerKey: 'jira_software:container:launch',
      url: 'https://jira.example/browse/OPS-42',
      lastSeenAt: new Date('2026-06-30T08:00:00Z')
    };
    const peer = {
      _id: 'item-2',
      workspaceId: 'workspace-object-id',
      sourceProvider: 'jira_software',
      connectorAccountId: 'account-1',
      externalId: 'OPS-43',
      canonicalKey: 'jira_software:OPS-43',
      title: 'Launch QA',
      itemType: 'issue',
      status: 'waiting',
      priority: 'normal',
      ownerKeys: [],
      labelKeys: [],
      lastSeenAt: new Date('2026-06-30T08:00:00Z')
    };
    const dependency = {
      _id: 'dep-1',
      workspaceId: 'workspace-object-id',
      sourceItemId: item,
      targetItemId: peer,
      dependencyType: 'blocks',
      sourceProvider: 'jira_software',
      externalId: 'jira_software:OPS-42:blocks:OPS-43',
      confidence: 0.91,
      evidenceRefs: [],
      metadata: {},
      createdAt: new Date('2026-06-30T08:00:00Z'),
      updatedAt: new Date('2026-06-30T08:10:00Z')
    };
    const recommendation = {
      _id: 'rec-1',
      title: 'Unblock Client launch blocker',
      findingType: 'graph_blocked_work',
      recommendedAction: 'Ask for blocker, owner, and next action.',
      actionType: 'escalate',
      riskLevel: 'high',
      ownerType: 'robert',
      status: 'pending',
      requiresApproval: true,
      approvalReason: 'Provider writes are blocked.',
      confidence: 0.84,
      createdAt: new Date('2026-06-30T08:20:00Z'),
      updatedAt: new Date('2026-06-30T08:20:00Z')
    };

    const chain = (items) => {
      const query = {
        populate: jest.fn(() => query),
        sort: jest.fn(() => query),
        limit: jest.fn().mockResolvedValue(items)
      };
      return query;
    };

    jest.doMock('mongoose', () => ({ connection: { readyState: 1 } }));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn(() => 'workspace-object-id'),
      getDefaultWorkspaceObjectId: jest.fn(() => 'workspace-object-id')
    }));
    jest.doMock('../src/models/WorkItem', () => ({ findOne: jest.fn().mockResolvedValue(item) }));
    jest.doMock('../src/models/WorkDependency', () => ({ find: jest.fn().mockReturnValue(chain([dependency])) }));
    jest.doMock('../src/models/WorkComment', () => ({}));
    jest.doMock('../src/models/WorkContainer', () => ({
      findOne: jest.fn().mockResolvedValue({
        _id: 'container-1',
        sourceProvider: 'jira_software',
        externalId: 'jira_software:container:launch',
        name: 'Launch',
        containerType: 'project',
        lastSeenAt: new Date('2026-06-30T08:00:00Z')
      })
    }));
    jest.doMock('../src/models/WorkActor', () => ({
      find: jest.fn().mockReturnValue(chain([{
        _id: 'actor-1',
        sourceProvider: 'jira_software',
        externalId: 'actor:nina',
        displayName: 'Nina',
        actorType: 'person',
        lastSeenAt: new Date('2026-06-30T08:00:00Z')
      }]))
    }));
    jest.doMock('../src/models/WorkEvent', () => ({
      find: jest.fn().mockReturnValue(chain([{
        _id: 'event-1',
        sourceProvider: 'jira_software',
        externalId: 'OPS-42',
        eventType: 'synced',
        occurredAt: new Date('2026-06-30T08:00:00Z'),
        summary: 'Client launch blocker synced',
        metadata: {}
      }]))
    }));
    jest.doMock('../src/models/Recommendation', () => ({ find: jest.fn().mockReturnValue(chain([recommendation])) }));

    const workGraphService = require('../src/services/workGraphService');
    const detail = await workGraphService.getItemDetail('item-1', { workspaceId: 'tenant-a' });

    expect(detail.item).toMatchObject({
      id: 'item-1',
      title: 'Client launch blocker',
      sourceProvider: 'jira_software'
    });
    expect(detail.dependencySummary).toMatchObject({
      dependencyCount: 1,
      blockingCount: 1,
      blockedByCount: 0
    });
    expect(detail.dependencies[0]).toMatchObject({
      direction: 'outgoing',
      relationship: 'This item blocks the linked item',
      peerItem: expect.objectContaining({
        id: 'item-2',
        title: 'Launch QA'
      })
    });
    expect(detail.recommendations[0]).toMatchObject({
      id: 'rec-1',
      status: 'pending'
    });
    expect(detail.candidate).toMatchObject({
      findingType: 'graph_blocked_work',
      dependencySummary: expect.objectContaining({
        blockingCount: 1
      })
    });
  });

  test('returns Trello board graph context for operating-ledger drilldowns', async () => {
    jest.resetModules();

    const board = {
      _id: 'board-db-1',
      workspaceId: 'workspace-object-id',
      trelloId: 'trello-board-1',
      name: 'Growth Experiments'
    };
    const card = {
      _id: 'card-db-1',
      workspaceId: 'workspace-object-id',
      trelloId: 'trello-card-1',
      name: 'Client launch blocker'
    };
    const item = {
      _id: 'item-1',
      workspaceId: 'workspace-object-id',
      sourceProvider: 'trello',
      externalId: 'trello-card-1',
      canonicalKey: 'trello:trello-card-1',
      title: 'Client launch blocker',
      description: 'Waiting on client approval',
      itemType: 'card',
      status: 'blocked',
      priority: 'high',
      ownerKeys: ['trello:actor:nina'],
      labelKeys: ['client'],
      containerKey: 'trello:container:trello-board-1',
      url: 'https://trello.example/c/launch',
      lastSeenAt: new Date('2026-06-30T08:00:00Z')
    };
    const peer = {
      _id: 'item-2',
      workspaceId: 'workspace-object-id',
      sourceProvider: 'trello',
      externalId: 'trello-card-2',
      canonicalKey: 'trello:trello-card-2',
      title: 'Launch QA',
      itemType: 'card',
      status: 'waiting',
      priority: 'normal',
      ownerKeys: [],
      labelKeys: [],
      lastSeenAt: new Date('2026-06-30T08:00:00Z')
    };
    const dependency = {
      _id: 'dep-1',
      workspaceId: 'workspace-object-id',
      sourceItemId: item,
      targetItemId: peer,
      dependencyType: 'blocks',
      sourceProvider: 'trello',
      externalId: 'trello:trello-card-1:blocks:trello-card-2',
      confidence: 0.91,
      evidenceRefs: [],
      metadata: {},
      createdAt: new Date('2026-06-30T08:00:00Z'),
      updatedAt: new Date('2026-06-30T08:10:00Z')
    };
    const recommendation = {
      _id: 'rec-1',
      title: 'Unblock Client launch blocker',
      findingType: 'graph_blocked_work',
      recommendedAction: 'Ask for blocker, owner, and next action.',
      actionType: 'escalate',
      actionPayload: {
        workItemId: 'item-1',
        sourceProvider: 'trello',
        externalId: 'trello-card-1',
        providerUrl: 'https://trello.example/c/launch'
      },
      riskLevel: 'high',
      ownerType: 'robert',
      status: 'pending',
      requiresApproval: true,
      approvalReason: 'Provider writes are blocked.',
      confidence: 0.84,
      createdAt: new Date('2026-06-30T08:20:00Z'),
      updatedAt: new Date('2026-06-30T08:20:00Z')
    };

    const chain = (items) => {
      const query = {
        populate: jest.fn(() => query),
        sort: jest.fn(() => query),
        limit: jest.fn().mockResolvedValue(items)
      };
      return query;
    };
    const workItemFind = jest.fn().mockReturnValue(chain([item]));

    jest.doMock('mongoose', () => ({ connection: { readyState: 1 } }));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn(() => 'workspace-object-id'),
      getDefaultWorkspaceObjectId: jest.fn(() => 'workspace-object-id')
    }));
    jest.doMock('../src/models/WorkItem', () => ({ find: workItemFind }));
    jest.doMock('../src/models/WorkDependency', () => ({ find: jest.fn().mockReturnValue(chain([dependency])) }));
    jest.doMock('../src/models/WorkComment', () => ({}));
    jest.doMock('../src/models/WorkContainer', () => ({}));
    jest.doMock('../src/models/WorkActor', () => ({}));
    jest.doMock('../src/models/WorkEvent', () => ({}));
    jest.doMock('../src/models/Recommendation', () => ({ find: jest.fn().mockReturnValue(chain([recommendation])) }));

    const workGraphService = require('../src/services/workGraphService');
    const context = await workGraphService.getTrelloBoardLedgerContext(board, [card], {
      workspaceId: 'tenant-a',
      limit: 10
    });

    expect(workItemFind).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-object-id',
      sourceProvider: 'trello',
      $or: expect.arrayContaining([
        expect.objectContaining({
          containerKey: {
            $in: expect.arrayContaining(['trello:container:trello-board-1'])
          }
        }),
        expect.objectContaining({
          externalId: {
            $in: expect.arrayContaining(['trello-card-1', 'card-db-1'])
          }
        })
      ])
    }));
    expect(context).toMatchObject({
      contextType: 'board',
      sourceProvider: 'trello',
      sourceId: 'trello-board-1',
      sourceName: 'Growth Experiments',
      counts: {
        items: 1,
        dependencies: 1,
        recommendations: 1,
        decisions: 1
      }
    });
    expect(context.filters).toEqual({
      providers: ['trello'],
      dependencyTypes: ['blocks'],
      directions: ['related']
    });
    expect(context.sourceLinks).toEqual([
      expect.objectContaining({
        sourceProvider: 'trello',
        externalId: 'trello-card-1',
        title: 'Client launch blocker',
        url: 'https://trello.example/c/launch'
      })
    ]);
    expect(context.items[0]).toMatchObject({
      id: 'item-1',
      candidate: expect.objectContaining({
        findingType: 'graph_blocked_work',
        dependencySummary: expect.objectContaining({
          blockingCount: 1
        })
      }),
      recommendations: [
        expect.objectContaining({
          id: 'rec-1',
          status: 'pending'
        })
      ]
    });
    expect(context.dependencies[0]).toMatchObject({
      direction: 'related',
      sourceItem: expect.objectContaining({ title: 'Client launch blocker' }),
      targetItem: expect.objectContaining({ title: 'Launch QA' })
    });
    expect(context.recommendations[0]).toMatchObject({
      sourceProvider: 'trello',
      externalId: 'trello-card-1',
      providerUrl: 'https://trello.example/c/launch',
      workItemId: 'item-1'
    });
  });

  test('queues direct graph item recommendations with dependency-aware approval context', async () => {
    jest.resetModules();

    const item = {
      _id: 'item-1',
      workspaceId: 'workspace-object-id',
      sourceProvider: 'jira_software',
      connectorAccountId: 'account-1',
      externalId: 'OPS-42',
      canonicalKey: 'jira_software:OPS-42',
      title: 'Client launch blocker',
      description: 'Waiting on client approval',
      itemType: 'issue',
      status: 'blocked',
      priority: 'high',
      ownerKeys: ['jira_software:actor:nina'],
      labelKeys: ['client'],
      url: 'https://jira.example/browse/OPS-42',
      lastSeenAt: new Date('2026-06-30T08:00:00Z')
    };
    const dependency = {
      _id: 'dep-1',
      workspaceId: 'workspace-object-id',
      sourceItemId: item,
      targetItemId: { _id: 'item-2' },
      dependencyType: 'blocks',
      sourceProvider: 'jira_software',
      externalId: 'dep-1'
    };
    const createdRecommendation = {
      _id: 'rec-1',
      workspaceId: 'workspace-object-id',
      ownerType: 'robert',
      title: 'Unblock Client launch blocker',
      recommendedAction: 'Ask for blocker, owner, and next action.',
      actionType: 'escalate',
      riskLevel: 'high',
      sourceEvidence: [],
      toObject: () => ({ _id: 'rec-1' })
    };
    const recommendationCreate = jest.fn().mockResolvedValue(createdRecommendation);

    const chain = (items) => {
      const query = {
        limit: jest.fn().mockResolvedValue(items)
      };
      return query;
    };

    jest.doMock('mongoose', () => ({ connection: { readyState: 1 } }));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn(() => 'workspace-object-id'),
      getDefaultWorkspaceObjectId: jest.fn(() => 'workspace-object-id')
    }));
    jest.doMock('../src/models/WorkItem', () => ({ findOne: jest.fn().mockResolvedValue(item) }));
    jest.doMock('../src/models/WorkDependency', () => ({ find: jest.fn().mockReturnValue(chain([dependency])) }));
    jest.doMock('../src/models/Recommendation', () => ({
      findOne: jest.fn().mockResolvedValue(null),
      create: recommendationCreate
    }));
    jest.doMock('../src/models/DecisionQueueItem', () => ({
      create: jest.fn().mockResolvedValue({ _id: 'decision-1' }),
      findOne: jest.fn()
    }));
    jest.doMock('../src/models/AuditEvent', () => ({
      create: jest.fn().mockResolvedValue({ _id: 'audit-1' })
    }));
    jest.doMock('../src/models/Approval', () => ({}));
    jest.doMock('../src/models/TrelloActionAttempt', () => ({}));
    jest.doMock('../src/models/FollowUpPlan', () => ({}));
    jest.doMock('../src/models/WorkerResponse', () => ({}));
    jest.doMock('../src/models/CardFinding', () => ({}));
    jest.doMock('../src/models/Intervention', () => ({}));
    jest.doMock('../src/models/BoardHealthSnapshot', () => ({}));
    jest.doMock('../src/models/Board', () => ({}));
    jest.doMock('../src/models/Card', () => ({}));
    jest.doMock('../src/models/Member', () => ({}));
    jest.doMock('../src/models/WorkActor', () => ({}));
    jest.doMock('../src/models/WorkComment', () => ({}));
    jest.doMock('../src/models/WorkContainer', () => ({}));
    jest.doMock('../src/models/WorkEvent', () => ({}));
    jest.doMock('../src/services/trelloClient', () => ({}));
    jest.doMock('../src/services/interventionPolicy', () => ({
      classifyAction: jest.fn(() => ({
        riskLevel: 'high',
        ownerType: 'robert',
        approvalReason: 'Approval required'
      }))
    }));

    const operationsLedgerService = require('../src/services/operationsLedgerService');
    await operationsLedgerService.createRecommendationFromWorkItem('item-1', {
      workspaceId: 'tenant-a',
      actor: 'robert'
    });

    expect(recommendationCreate).toHaveBeenCalledWith(expect.objectContaining({
      actionPayload: expect.objectContaining({
        workItemId: 'item-1',
        dependencySummary: expect.objectContaining({
          dependencyCount: 1,
          blockingCount: 1
        }),
        externalProviderWriteBlocked: true,
        executable: false,
        draftOnly: true
      }),
      sourceEvidence: [
        expect.objectContaining({
          data: expect.objectContaining({
            dependencySummary: expect.objectContaining({
              blockingCount: 1
            })
          })
        })
      ]
    }));
  });
});

describe('mission-control evidence references', () => {
  test('attaches source evidence to focus, command, and risk items', () => {
    const autopilotService = require('../src/services/autopilotService');
    const boardId = new mongoose.Types.ObjectId();
    const listId = new mongoose.Types.ObjectId();
    const cardId = new mongoose.Types.ObjectId();
    const memberId = new mongoose.Types.ObjectId();
    const card = {
      _id: cardId,
      trelloId: 'trello-card-1',
      name: 'Recover overdue onboarding card',
      boardId: { _id: boardId, name: 'Client Launches', url: 'https://trello.example/board' },
      listId: { _id: listId, name: 'Review' },
      members: [{ _id: memberId, username: 'nina' }],
      due: new Date(Date.now() - 24 * 60 * 60 * 1000),
      dueComplete: false,
      closed: false,
      riskLevel: 'critical',
      riskFactors: ['Client launch is blocked'],
      lastActivity: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      labels: [{ name: 'Blocked' }]
    };

    const focus = autopilotService.buildFocusQueue([card]);
    const risks = autopilotService.buildRiskRadar([card], {});
    const commands = autopilotService.buildCommandQueue({
      cards: [card],
      boardSummaries: [],
      teamLoad: [{
        id: memberId,
        username: 'nina',
        fullName: 'Nina Jacobs',
        assignedCards: 12,
        urgentCards: 4,
        overdueCards: 2,
        capacityState: 'overloaded'
      }],
      interventions: []
    });

    expect(focus[0].sourceEvidence[0]).toMatchObject({
      type: 'card',
      entityId: cardId,
      label: 'Recover overdue onboarding card',
      data: expect.objectContaining({
        reason: 'Priority score and focus queue position',
        trelloId: 'trello-card-1',
        boardName: 'Client Launches',
        listName: 'Review'
      })
    });
    expect(commands.find(command => command.type === 'escalate_overdue').sourceEvidence[0].data.reason).toBe('Overdue open card');
    expect(commands.find(command => command.type === 'rebalance_workload').sourceEvidence[0]).toMatchObject({
      type: 'member',
      label: 'Nina Jacobs'
    });
    expect(risks.find(risk => risk.type === 'delivery_risk').sourceEvidence[0].data.reason).toBe('High delivery risk');
  });

  test('ranks dependency-aware graph decisions into mission-control commands and risks', () => {
    const autopilotService = require('../src/services/autopilotService');
    const workItemId = new mongoose.Types.ObjectId();
    const graphCandidate = {
      workItemId: String(workItemId),
      findingType: 'graph_blocked_work',
      title: 'Unblock Jira release gate',
      description: 'The normalized work graph shows this item is blocked. It is blocking 2 downstream graph items.',
      recommendedAction: 'Ask for blocker, owner, and next action on "Jira release gate".',
      actionType: 'escalate',
      riskLevel: 'high',
      graphScore: 97,
      confidence: 0.84,
      ownerType: 'robert',
      sourceProvider: 'jira_software',
      externalId: 'OPS-42',
      canonicalKey: 'jira_software:OPS-42',
      dependencySummary: {
        dependencyCount: 3,
        blockingCount: 2,
        blockedByCount: 1,
        relatedCount: 0,
        dependencyTypes: { blocks: 2, blocked_by: 1 }
      },
      actionPayload: {
        source: 'work_graph',
        workItemId: String(workItemId),
        sourceProvider: 'jira_software',
        externalId: 'OPS-42',
        externalProviderWriteBlocked: true,
        executable: false,
        draftOnly: true
      },
      sourceEvidence: [
        {
          type: 'work_item',
          entityId: workItemId,
          label: 'Jira release gate',
          data: { reason: 'Graph dependency risk' }
        }
      ]
    };

    const commands = autopilotService.buildCommandQueue({
      cards: [],
      boardSummaries: [],
      teamLoad: [],
      interventions: [],
      graphCandidates: [graphCandidate]
    });
    const risks = autopilotService.buildRiskRadar([], {}, [graphCandidate]);
    const signals = autopilotService.buildSignals([], [], [], risks, [graphCandidate]);

    expect(commands[0]).toMatchObject({
      type: 'graph_decision',
      severity: 'high',
      title: 'Unblock Jira release gate',
      owner: 'robert',
      automatable: false,
      graphScore: 97,
      payload: expect.objectContaining({
        source: 'work_graph',
        workItemId: String(workItemId),
        dependencySummary: expect.objectContaining({
          blockingCount: 2
        }),
        actionPayload: expect.objectContaining({
          externalProviderWriteBlocked: true,
          executable: false,
          draftOnly: true
        })
      })
    });
    expect(commands[0].sourceEvidence[0]).toMatchObject({
      type: 'work_item',
      label: 'Jira release gate'
    });
    expect(risks[0]).toMatchObject({
      type: 'graph_blocked_work',
      score: 97,
      title: 'Unblock Jira release gate'
    });
    expect(signals.graphDecisions).toBe(1);
  });
});

describe('chat source evidence', () => {
  test('builds card and analytics evidence for worker responses', () => {
    jest.resetModules();
    jest.doMock('../src/services/teamManager', () => ({
      analyzeTeamWorkload: jest.fn()
    }));
    const conversationalAI = require('../src/services/conversationalAI');
    const cardId = new mongoose.Types.ObjectId();
    const evidence = conversationalAI.buildResponseSourceEvidence({
      cards: [{
        id: cardId,
        trelloId: 'trello-card-2',
        name: 'Ship dashboard evidence modal',
        boardId: 'board-1',
        boardName: 'Sneup Product',
        listId: 'list-1',
        listName: 'Build',
        due: new Date('2026-07-01T10:00:00Z'),
        riskLevel: 'high',
        isOverdue: false
      }],
      performance: {
        score: 82,
        grade: 'B',
        completionRate: 75,
        onTimeRate: 80,
        flags: ['stable']
      }
    });

    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'card',
        entityId: cardId,
        label: 'Ship dashboard evidence modal',
        data: expect.objectContaining({
          reason: 'Assigned card used for chat response',
          trelloId: 'trello-card-2',
          boardName: 'Sneup Product',
          listName: 'Build'
        })
      }),
      expect.objectContaining({
        type: 'analytics',
        label: 'Latest member performance snapshot',
        data: expect.objectContaining({
          reason: 'Performance context used for chat response',
          score: 82
        })
      })
    ]));
  });
});

describe('enhancement backlog', () => {
  test('prioritizes actionable product and engineering findings', () => {
    const enhancements = enhancementBacklog.listEnhancements();
    const summary = enhancementBacklog.getSummary(enhancements);

    expect(enhancements.length).toBeGreaterThanOrEqual(12);
    expect(enhancements[0].priority).toBe('P0');
    expect(summary.byPriority.P0).toBeGreaterThanOrEqual(3);
    expect(enhancementBacklog.getEnhancement('ENH-001').title).toContain('provider sync adapters');
  });
});

describe('operations ledger intervention policy', () => {
  test('requires approval for Trello write actions', () => {
    const interventionPolicy = require('../src/services/interventionPolicy');

    expect(interventionPolicy.classifyAction('comment', { severity: 'medium' })).toMatchObject({
      riskLevel: 'medium',
      requiresApproval: true,
      ownerType: 'team'
    });

    expect(interventionPolicy.classifyAction('move_card', { severity: 'high' })).toMatchObject({
      riskLevel: 'high',
      requiresApproval: true,
      ownerType: 'robert'
    });

    expect(interventionPolicy.classifyAction('analysis')).toMatchObject({
      riskLevel: 'low',
      requiresApproval: false,
      ownerType: 'system'
    });
  });

  test('intervention execution queues approval instead of writing directly to Trello', async () => {
    jest.resetModules();

    const recommendation = { _id: 'recommendation-1' };
    const createRecommendationFromIntervention = jest.fn().mockResolvedValue(recommendation);
    const trelloClient = {
      addCommentToCard: jest.fn(),
      removeMemberFromCard: jest.fn(),
      addMemberToCard: jest.fn(),
      moveCardToList: jest.fn(),
      addLabelToCard: jest.fn()
    };

    jest.doMock('../src/services/operationsLedgerService', () => ({
      createRecommendationFromIntervention
    }));
    jest.doMock('../src/services/trelloClient', () => trelloClient);

    const interventionEngine = require('../src/services/interventionEngine');
    const intervention = {
      _id: 'intervention-1',
      type: 'comment',
      severity: 'medium',
      action: 'Request status update',
      message: 'Please update this card.',
      metadata: {},
      save: jest.fn().mockResolvedValue(null),
      markFailed: jest.fn()
    };
    intervention.save.mockResolvedValue(intervention);

    const result = await interventionEngine.executeIntervention(intervention);

    expect(result).toMatchObject({
      executed: false,
      requiresApproval: true,
      recommendation
    });
    expect(createRecommendationFromIntervention).toHaveBeenCalledTimes(1);
    expect(trelloClient.addCommentToCard).not.toHaveBeenCalled();
    expect(trelloClient.removeMemberFromCard).not.toHaveBeenCalled();
    expect(trelloClient.addMemberToCard).not.toHaveBeenCalled();
    expect(trelloClient.moveCardToList).not.toHaveBeenCalled();
    expect(trelloClient.addLabelToCard).not.toHaveBeenCalled();
  });
});

describe('operating ledger analyzer', () => {
  test('detects stale, blocked, Robert-required, and missing-next-action findings without Trello writes', () => {
    const analyzer = require('../src/services/operatingLedgerAnalyzer');
    const board = {
      _id: 'board-1',
      name: 'Client Launches',
      url: 'https://trello.example/board'
    };
    const card = {
      _id: 'card-1',
      name: 'Client contract blocked',
      description: 'Waiting on client contract signature before launch.',
      labels: [{ name: 'BLOCKED' }],
      members: [],
      checklists: [],
      due: new Date(Date.now() - 24 * 60 * 60 * 1000),
      dueComplete: false,
      closed: false,
      lastActivity: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
      isOverdue: () => true,
      isStuck: () => false
    };

    const findings = analyzer.detectCardFindings(board, card);
    const types = findings.map(finding => finding.findingType);

    expect(types).toEqual(expect.arrayContaining([
      'overdue',
      'unassigned',
      'stale',
      'missing_next_action',
      'blocked',
      'robert_required',
      'external_waiting'
    ]));
    expect(findings.find(finding => finding.findingType === 'robert_required').waitingOn).toBe('robert');
    expect(findings.find(finding => finding.findingType === 'blocked').severity).toBe('critical');
  });

  test('maps finding owners into supported decision queue owner types', () => {
    const analyzer = require('../src/services/operatingLedgerAnalyzer');

    expect(analyzer.ownerTypeForFinding({ waitingOn: 'robert' })).toBe('robert');
    expect(analyzer.ownerTypeForFinding({ waitingOn: 'va' })).toBe('va');
    expect(analyzer.ownerTypeForFinding({ waitingOn: 'worker' })).toBe('team');
    expect(analyzer.ownerTypeForFinding({ waitingOn: 'external' })).toBe('team');
    expect(analyzer.ownerTypeForFinding({ waitingOn: 'unknown' })).toBe('team');
  });
});

describe('operations daily brief', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.dontMock('mongoose');
    jest.dontMock('../src/services/workspaceScopeService');
    jest.dontMock('../src/models/DecisionQueueItem');
    jest.dontMock('../src/models/Recommendation');
    jest.dontMock('../src/models/TrelloActionAttempt');
    jest.dontMock('../src/models/FollowUpPlan');
    jest.dontMock('../src/models/CardFinding');
    jest.dontMock('../src/models/BoardHealthSnapshot');
    jest.dontMock('../src/services/workGraphService');
    jest.resetModules();
  });

  test('scopes live operations brief queries to the request workspace', async () => {
    jest.resetModules();

    const queryLog = {};
    const makeModel = (name) => ({
      find: jest.fn((query) => {
        queryLog[name] = query;
        const chain = {
          populate: jest.fn(() => chain),
          sort: jest.fn(() => chain),
          limit: jest.fn().mockResolvedValue([])
        };
        return chain;
      })
    });

    jest.doMock('mongoose', () => ({ connection: { readyState: 1 } }));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn(() => 'workspace-object-id')
    }));
    jest.doMock('../src/models/DecisionQueueItem', () => makeModel('DecisionQueueItem'));
    jest.doMock('../src/models/Recommendation', () => makeModel('Recommendation'));
    jest.doMock('../src/models/TrelloActionAttempt', () => makeModel('TrelloActionAttempt'));
    jest.doMock('../src/models/FollowUpPlan', () => makeModel('FollowUpPlan'));
    jest.doMock('../src/models/CardFinding', () => makeModel('CardFinding'));
    jest.doMock('../src/models/BoardHealthSnapshot', () => makeModel('BoardHealthSnapshot'));
    jest.doMock('../src/services/workGraphService', () => ({
      listDecisionCandidates: jest.fn().mockResolvedValue({ count: 0, candidates: [] })
    }));

    const operationsBriefService = require('../src/services/operationsBriefService');
    const workGraphService = require('../src/services/workGraphService');
    jest.spyOn(operationsBriefService, 'buildBrief').mockReturnValue({ mode: 'live' });

    await expect(operationsBriefService.getDailyBrief({
      workspaceId: 'tenant-a',
      limit: 5
    })).resolves.toEqual({ mode: 'live' });

    expect(queryLog.DecisionQueueItem).toMatchObject({ workspaceId: 'workspace-object-id' });
    expect(queryLog.Recommendation).toMatchObject({ workspaceId: 'workspace-object-id' });
    expect(queryLog.TrelloActionAttempt).toMatchObject({ workspaceId: 'workspace-object-id' });
    expect(queryLog.FollowUpPlan).toMatchObject({ workspaceId: 'workspace-object-id' });
    expect(queryLog.CardFinding).toMatchObject({ workspaceId: 'workspace-object-id' });
    expect(queryLog.BoardHealthSnapshot).toMatchObject({ workspaceId: 'workspace-object-id' });
    expect(workGraphService.listDecisionCandidates).toHaveBeenCalledWith({
      workspaceId: 'workspace-object-id',
      limit: 5
    });
  });

  test('prioritizes failed actions and separates Robert, VA, and team queues', () => {
    const operationsBriefService = require('../src/services/operationsBriefService');

    const brief = operationsBriefService.buildBrief({
      mode: 'live',
      generatedAt: new Date('2026-06-29T08:00:00Z'),
      decisions: [
        {
          _id: 'decision-robert',
          ownerType: 'robert',
          question: 'Approve client launch escalation: Yes/No.',
          reason: 'Client launch is blocked.',
          riskLevel: 'critical',
          status: 'open'
        },
        {
          _id: 'decision-team',
          ownerType: 'team',
          question: 'Ask worker for update: Yes/No.',
          reason: 'No activity for 8 days.',
          riskLevel: 'medium',
          status: 'open'
        }
      ],
      recommendations: [
        {
          _id: 'recommendation-1',
          status: 'pending',
          riskLevel: 'high',
          recommendedAction: 'Post follow-up comment'
        }
      ],
      failedActions: [
        {
          _id: 'failed-action-1',
          actionType: 'comment',
          status: 'failed',
          errorMessage: 'Trello token rejected'
        }
      ],
      dueFollowUps: [
        {
          _id: 'follow-up-1',
          reason: 'Verify worker response',
          status: 'due',
          dueAt: new Date('2026-06-29T07:00:00Z')
        }
      ],
      findings: [
        {
          _id: 'finding-va',
          title: 'Card is VA-ready',
          waitingOn: 'va',
          severity: 'high',
          status: 'open'
        },
        {
          _id: 'finding-worker',
          title: 'Worker follow-up needed',
          waitingOn: 'worker',
          severity: 'medium',
          status: 'open'
        }
      ],
      healthSnapshots: [
        {
          _id: 'health-1',
          boardId: { _id: 'board-1', name: 'Growth Experiments' },
          healthStatus: 'critical',
          healthScore: 38,
          summary: 'Blocked dependencies'
        }
      ]
    });

    expect(brief.readonly).toBe(true);
    expect(brief.headline).toContain('failed Trello action');
    expect(brief.nextDecision).toBe('Approve client launch escalation: Yes/No.');
    expect(brief.counts).toMatchObject({
      robertDecisions: 1,
      vaReady: 1,
      teamQueue: 2,
      failedActions: 1,
      dueFollowUps: 1,
      boardsAtRisk: 1
    });
    expect(brief.robertDecisions[0]).toMatchObject({
      type: 'robert_decision',
      riskLevel: 'critical'
    });
    expect(brief.vaReady[0].title).toBe('Card is VA-ready');
    expect(brief.teamQueue.map(item => item.title)).toEqual(expect.arrayContaining([
      'Ask worker for update: Yes/No.',
      'Worker follow-up needed'
    ]));
    expect(brief.morningPlan[0]).toContain('failed Trello action');
  });

  test('promotes graph decision candidates into the read-only daily brief', () => {
    const operationsBriefService = require('../src/services/operationsBriefService');

    const brief = operationsBriefService.buildBrief({
      mode: 'live',
      generatedAt: new Date('2026-06-29T08:00:00Z'),
      graphDecisionCandidates: [
        {
          workItemId: 'work-item-robert',
          ownerType: 'robert',
          title: 'Robert review: Client budget approval',
          description: 'Sensitive client budget work needs Robert review.',
          riskLevel: 'high',
          sourceProvider: 'asana',
          externalId: 'task-1',
          providerUrl: 'https://asana.example/task-1',
          actionPayload: {
            draftOnly: true,
            executable: false
          },
          sourceEvidence: [
            { type: 'work_item', label: 'Client budget approval' }
          ]
        },
        {
          workItemId: 'work-item-va',
          ownerType: 'va',
          title: 'Assign owner: Analytics webhook rollout',
          description: 'The graph has no owner for this open item.',
          riskLevel: 'medium',
          sourceProvider: 'github',
          externalId: 'issue-5',
          actionPayload: {
            draftOnly: true,
            executable: false
          },
          sourceEvidence: [
            { type: 'work_item', label: 'Analytics webhook rollout' }
          ]
        },
        {
          workItemId: 'work-item-team',
          ownerType: 'team',
          title: 'Follow up waiting item: Legal checklist',
          description: 'The normalized work graph shows this item is waiting.',
          riskLevel: 'medium',
          sourceProvider: 'jira_software',
          externalId: 'OPS-4',
          actionPayload: {
            draftOnly: true,
            executable: false
          }
        }
      ]
    });

    expect(brief.readonly).toBe(true);
    expect(brief.counts).toMatchObject({
      robertDecisions: 1,
      vaReady: 1,
      teamQueue: 1,
      graphDecisions: 3
    });
    expect(brief.nextDecision).toBe('Robert review: Client budget approval Approve: Yes/No.');
    expect(brief.robertDecisions[0]).toMatchObject({
      id: 'work-item-robert',
      type: 'robert_decision',
      sourceSystem: 'work_graph',
      sourceProvider: 'asana',
      providerUrl: 'https://asana.example/task-1',
      draftOnly: true,
      executable: false,
      sourceCount: 1
    });
    expect(brief.vaReady[0]).toMatchObject({
      id: 'work-item-va',
      type: 'va_ready',
      sourceProvider: 'github',
      draftOnly: true
    });
    expect(brief.teamQueue[0]).toMatchObject({
      id: 'work-item-team',
      type: 'team_queue',
      sourceProvider: 'jira_software',
      draftOnly: true
    });
  });
});

describe('follow-up accountability', () => {
  afterEach(() => {
    jest.dontMock('mongoose');
    jest.dontMock('../src/models/WorkerResponse');
    jest.dontMock('../src/models/FollowUpPlan');
    jest.dontMock('../src/models/Intervention');
    jest.dontMock('../src/models/AuditEvent');
    jest.dontMock('../src/models/Recommendation');
    jest.dontMock('../src/models/Approval');
    jest.dontMock('../src/models/TrelloActionAttempt');
    jest.dontMock('../src/models/DecisionQueueItem');
    jest.dontMock('../src/models/CardFinding');
    jest.dontMock('../src/models/BoardHealthSnapshot');
    jest.dontMock('../src/models/Board');
    jest.dontMock('../src/models/Card');
    jest.dontMock('../src/models/Member');
    jest.dontMock('../src/services/trelloClient');
    jest.dontMock('../src/services/workspaceScopeService');
    jest.dontMock('../src/services/operationsLedgerService');
    jest.resetModules();
  });

  test('worker responses close matching open follow-up plans', async () => {
    jest.resetModules();

    const workspaceId = new mongoose.Types.ObjectId();
    const recommendationId = new mongoose.Types.ObjectId();
    const interventionId = new mongoose.Types.ObjectId();
    const cardId = new mongoose.Types.ObjectId();
    const memberId = new mongoose.Types.ObjectId();
    const responseId = new mongoose.Types.ObjectId();

    const response = {
      _id: responseId,
      workspaceId,
      recommendationId,
      interventionId,
      cardId,
      memberId,
      responseText: 'Done and ready for review.',
      responseType: 'completed',
      source: 'api',
      toObject() {
        return {
          _id: responseId,
          workspaceId,
          recommendationId,
          interventionId,
          cardId,
          memberId,
          responseText: this.responseText,
          responseType: this.responseType,
          source: this.source
        };
      }
    };

    const updateMany = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const auditCreate = jest.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

    jest.doMock('mongoose', () => ({
      ...mongoose,
      connection: { readyState: 1 }
    }));
    jest.doMock('../src/models/WorkerResponse', () => ({
      create: jest.fn().mockResolvedValue(response)
    }));
    jest.doMock('../src/models/FollowUpPlan', () => ({
      updateMany
    }));
    jest.doMock('../src/models/Intervention', () => ({
      findOne: jest.fn().mockResolvedValue(null)
    }));
    jest.doMock('../src/models/AuditEvent', () => ({
      create: auditCreate
    }));
    [
      '../src/models/Recommendation',
      '../src/models/Approval',
      '../src/models/TrelloActionAttempt',
      '../src/models/DecisionQueueItem',
      '../src/models/CardFinding',
      '../src/models/BoardHealthSnapshot',
      '../src/models/Board',
      '../src/models/Card',
      '../src/models/Member'
    ].forEach((modelPath) => {
      jest.doMock(modelPath, () => ({}));
    });
    jest.doMock('../src/services/trelloClient', () => ({}));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn((value) => value || workspaceId)
    }));
    jest.dontMock('../src/services/operationsLedgerService');

    const operationsLedgerService = require('../src/services/operationsLedgerService');
    await expect(operationsLedgerService.recordWorkerResponse({
      workspaceId,
      recommendationId,
      interventionId,
      cardId,
      memberId,
      responseText: response.responseText,
      responseType: response.responseType,
      actor: 'worker-1'
    })).resolves.toMatchObject({
      responseType: 'completed'
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        status: { $in: ['scheduled', 'due'] },
        $or: expect.arrayContaining([
          { recommendationId },
          { interventionId },
          { cardId, memberId }
        ])
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'resolved',
          resolvedBy: 'worker-1',
          resolutionNote: 'Worker response recorded: completed',
          outcome: 'completed'
        })
      })
    );
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'worker_response_recorded'
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'follow_ups_resolved_from_worker_response',
      actor: 'worker-1'
    }));
  });
});

describe('autopilot command approval queue', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.dontMock('../src/services/operationsLedgerService');
  });

  test('maps autopilot update commands into executable approval-gated Trello comment drafts', () => {
    const operationsLedgerService = require('../src/services/operationsLedgerService');
    const boardId = new mongoose.Types.ObjectId();
    const cardId = new mongoose.Types.ObjectId();
    const card = {
      _id: cardId,
      boardId,
      trelloId: 'trello-card-1',
      name: 'Clear copy approvals',
      url: 'https://trello.example/card',
      updatedAt: new Date('2026-06-29T07:00:00Z')
    };
    const command = operationsLedgerService.normalizeAutopilotCommand({
      id: 'request_update-trello-card-1',
      type: 'request_update',
      severity: 'medium',
      title: 'Request a crisp update: Clear copy approvals',
      target: 'Growth Experiments',
      owner: 'milan',
      reason: 'No activity for 6 days',
      automatable: true,
      minutesSaved: 8,
      payload: { cardId, trelloId: 'trello-card-1' }
    });

    const spec = operationsLedgerService.buildAutopilotActionSpec(command, card);

    expect(spec).toMatchObject({
      actionType: 'comment',
      recommendedAction: 'Post a Trello status request for "Request a crisp update: Clear copy approvals".',
      confidence: 0.72
    });
    expect(spec.actionPayload).toMatchObject({
      commandId: 'request_update-trello-card-1',
      executable: true,
      draftOnly: false,
      cardTrelloId: 'trello-card-1'
    });
    expect(spec.actionPayload.commentText).toContain('next concrete action');
  });

  test('marks autopilot commands that need human payload selection as non-executable drafts', () => {
    const operationsLedgerService = require('../src/services/operationsLedgerService');
    const command = operationsLedgerService.normalizeAutopilotCommand({
      id: 'assign_owner-card-1',
      type: 'assign_owner',
      severity: 'high',
      title: 'Assign an owner: Analytics webhook rollout',
      target: 'Growth Experiments',
      owner: 'Sneup',
      reason: 'Unowned work has no accountable path to completion',
      automatable: true,
      payload: { cardId: 'not-a-mongo-id' }
    });

    const spec = operationsLedgerService.buildAutopilotActionSpec(command);

    expect(spec).toMatchObject({
      actionType: 'reassign',
      ownerType: 'robert'
    });
    expect(spec.actionPayload).toMatchObject({
      executable: false,
      draftOnly: true,
      requiredChange: 'Select toMemberId and toMemberTrelloId before execution.'
    });
    expect(operationsLedgerService.isExecutableRecommendation({
      actionType: spec.actionType,
      actionPayload: spec.actionPayload
    })).toBe(false);
  });

  test('keeps graph mission-control commands draft-only in the approval ledger', () => {
    const operationsLedgerService = require('../src/services/operationsLedgerService');
    const workItemId = new mongoose.Types.ObjectId();
    const command = operationsLedgerService.normalizeAutopilotCommand({
      id: `graph_decision-${workItemId}`,
      type: 'graph_decision',
      severity: 'high',
      title: 'Unblock Jira release gate',
      target: 'jira_software',
      owner: 'robert',
      reason: 'The normalized work graph shows this item blocks downstream work.',
      automatable: false,
      payload: {
        source: 'work_graph',
        workItemId: String(workItemId),
        sourceProvider: 'jira_software',
        externalId: 'OPS-42',
        ownerType: 'robert',
        recommendedAction: 'Ask for blocker, owner, and next action on "Jira release gate".',
        actionType: 'escalate',
        confidence: 0.84,
        dependencySummary: {
          dependencyCount: 3,
          blockingCount: 2,
          blockedByCount: 1
        },
        actionPayload: {
          source: 'work_graph',
          workItemId: String(workItemId),
          sourceProvider: 'jira_software',
          externalId: 'OPS-42',
          externalProviderWriteBlocked: true,
          executable: false,
          draftOnly: true
        },
        sourceEvidence: [
          {
            type: 'work_item',
            entityId: workItemId,
            label: 'Jira release gate'
          }
        ]
      }
    });

    const spec = operationsLedgerService.buildAutopilotActionSpec(command);
    const evidence = operationsLedgerService.buildAutopilotSourceEvidence(command);

    expect(spec).toMatchObject({
      actionType: 'escalate',
      ownerType: 'robert',
      riskLevel: 'high',
      confidence: 0.84
    });
    expect(spec.actionPayload).toMatchObject({
      source: 'work_graph',
      workItemId: String(workItemId),
      sourceProvider: 'jira_software',
      externalId: 'OPS-42',
      externalProviderWriteBlocked: true,
      executable: false,
      draftOnly: true,
      dependencySummary: expect.objectContaining({
        blockingCount: 2
      })
    });
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'work_item',
        label: 'Jira release gate'
      })
    ]));
    expect(operationsLedgerService.isExecutableRecommendation({
      actionType: spec.actionType,
      actionPayload: spec.actionPayload
    })).toBe(false);
  });

  test('blocks approved manual-review autopilot decisions from Trello execution', () => {
    const operationsLedgerService = require('../src/services/operationsLedgerService');

    expect(operationsLedgerService.isExecutableRecommendation({
      actionType: 'manual_review',
      actionPayload: { executable: false, draftOnly: true }
    })).toBe(false);

    expect(operationsLedgerService.isExecutableRecommendation({
      actionType: 'comment',
      actionPayload: { executable: true, cardTrelloId: 'card-1', commentText: 'Status?' }
    })).toBe(true);
  });
  test('models support snooze, delegate, and payload-edit approval states', () => {
    const DecisionQueueItem = require('../src/models/DecisionQueueItem');
    const Recommendation = require('../src/models/Recommendation');

    expect(DecisionQueueItem.schema.path('status').enumValues).toEqual(expect.arrayContaining([
      'snoozed',
      'delegated'
    ]));
    expect(DecisionQueueItem.schema.path('recommendedAnswer').enumValues).toEqual(expect.arrayContaining(['snooze', 'delegate']));
    expect(Recommendation.schema.path('status').enumValues).toEqual(expect.arrayContaining(['snoozed', 'delegated']));
    expect(DecisionQueueItem.schema.path('snoozedUntil')).toBeTruthy();
    expect(DecisionQueueItem.schema.path('delegatedTo')).toBeTruthy();
  });
});

describe('job observability', () => {
  test('redacts provider query credentials from connector sync errors', () => {
    const connectorSyncService = require('../src/services/connectorSyncService');
    const message = connectorSyncService.safeErrorMessage(new Error('Request failed: https://api.trello.com/1?key=api-secret&token=token-secret'));

    expect(message).toContain('key=[redacted]');
    expect(message).toContain('token=[redacted]');
    expect(message).not.toContain('api-secret');
    expect(message).not.toContain('token-secret');
  });

  test('paces connector syncs and retries transient provider failures without busy looping', async () => {
    const { ProviderSyncPolicyService } = require('../src/services/providerSyncPolicyService');
    let clock = 1000;
    const sleep = jest.fn(async (ms) => {
      clock += ms;
    });
    const policy = new ProviderSyncPolicyService({
      now: () => clock,
      sleep
    });
    const fetchDelta = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Too many requests'), { statusCode: 429, retryAfterMs: 100 }))
      .mockResolvedValueOnce({ records: [{ id: 'issue-1' }] });

    const result = await policy.run('github', fetchDelta, {
      minIntervalMs: 500,
      maxRetries: 2,
      retryBaseMs: 50,
      retryMaxMs: 1000
    });

    expect(result).toMatchObject({
      retryCount: 1,
      attemptCount: 2,
      rateLimitWaitMs: 400,
      result: { records: [{ id: 'issue-1' }] }
    });
    expect(fetchDelta).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 400]);

    await policy.run('github', async () => ({ records: [] }), { minIntervalMs: 500 });
    expect(sleep.mock.calls.at(-1)[0]).toBe(500);
  });

  test('builds job health with stale and failed classifications', () => {
    const jobObservabilityService = require('../src/services/jobObservabilityService');
    const now = new Date('2026-06-29T08:00:00Z');
    const runs = [
      {
        _id: 'run-1',
        jobName: 'trello.incremental_sync',
        jobType: 'sync',
        triggerType: 'scheduled',
        status: 'succeeded',
        startedAt: new Date('2026-06-29T07:50:00Z'),
        finishedAt: new Date('2026-06-29T07:51:00Z'),
        durationMs: 60000,
        processedCount: 4,
        successCount: 4,
        failureCount: 0,
        metadata: { retryCount: 2, rateLimitWaitMs: 1500 }
      },
      {
        _id: 'run-2',
        jobName: 'analytics.generate_all',
        jobType: 'analytics',
        triggerType: 'scheduled',
        status: 'failed',
        startedAt: new Date('2026-06-29T07:45:00Z'),
        finishedAt: new Date('2026-06-29T07:46:00Z'),
        durationMs: 60000,
        processedCount: 1,
        successCount: 0,
        failureCount: 1,
        errorMessage: 'Analytics failed'
      },
      {
        _id: 'run-3',
        jobName: 'interventions.process_all',
        jobType: 'intervention',
        triggerType: 'scheduled',
        status: 'succeeded',
        startedAt: new Date('2026-06-29T04:00:00Z'),
        finishedAt: new Date('2026-06-29T04:01:00Z'),
        durationMs: 60000,
        processedCount: 2,
        successCount: 2,
        failureCount: 0
      }
    ];

    const dashboard = jobObservabilityService.buildDashboard(runs, now);
    const incrementalSync = dashboard.health.find(job => job.jobName === 'trello.incremental_sync');
    const analytics = dashboard.health.find(job => job.jobName === 'analytics.generate_all');
    const interventions = dashboard.health.find(job => job.jobName === 'interventions.process_all');

    expect(incrementalSync.status).toBe('healthy');
    expect(incrementalSync.metadata).toMatchObject({ retryCount: 2, rateLimitWaitMs: 1500 });
    expect(analytics.status).toBe('failed');
    expect(interventions.status).toBe('stale');
    expect(dashboard.summary.failedRuns).toBe(1);
    expect(dashboard.recentRuns[0]).toMatchObject({
      jobName: 'trello.incremental_sync',
      status: 'succeeded'
    });
  });

  test('marks paused jobs as operator controlled and trigger-aware', () => {
    const jobObservabilityService = require('../src/services/jobObservabilityService');
    const now = new Date('2026-06-29T08:00:00Z');
    const runs = [
      {
        _id: 'run-paused',
        jobName: 'analytics.generate_all',
        jobType: 'analytics',
        triggerType: 'scheduled',
        status: 'succeeded',
        startedAt: new Date('2026-06-29T07:45:00Z'),
        finishedAt: new Date('2026-06-29T07:46:00Z'),
        durationMs: 60000
      }
    ];
    const controls = [
      {
        jobName: 'analytics.generate_all',
        status: 'paused',
        pausedAt: new Date('2026-06-29T07:55:00Z'),
        pausedBy: 'Operations Lead',
        pausedReason: 'Investigating source data drift'
      }
    ];

    const dashboard = jobObservabilityService.buildDashboard(runs, now, controls);
    const analytics = dashboard.health.find(job => job.jobName === 'analytics.generate_all');

    expect(analytics).toMatchObject({
      status: 'paused',
      paused: true,
      manualTriggerAllowed: true,
      pausedBy: 'Operations Lead',
      pausedReason: 'Investigating source data drift'
    });
    expect(dashboard.summary.pausedJobs).toBe(1);
  });

  test('tracks jobs without MongoDB and preserves failure propagation', async () => {
    const jobObservabilityService = require('../src/services/jobObservabilityService');

    await expect(jobObservabilityService.trackJob({
      jobName: 'test.no_db',
      jobType: 'system',
      triggerType: 'worker'
    }, async () => ({
      processedCount: 1,
      successCount: 1,
      failureCount: 0
    }))).resolves.toMatchObject({
      processedCount: 1,
      successCount: 1
    });

    await expect(jobObservabilityService.trackJob({
      jobName: 'test.no_db_failure',
      jobType: 'system',
      triggerType: 'worker'
    }, async () => {
      throw new Error('job failed');
    })).rejects.toThrow('job failed');
  });
});

describe('optional AI startup', () => {
  test('registers global process handlers only once across module reloads', () => {
    const { registerProcessHandlers } = require('../src/utils/processHandlers');
    const runtime = new EventEmitter();
    const logger = { info: jest.fn(), error: jest.fn() };
    const exit = jest.fn();

    expect(registerProcessHandlers(logger, { runtime, exit })).toBe(true);
    expect(registerProcessHandlers(logger, { runtime, exit })).toBe(false);
    expect(runtime.listeners('SIGTERM')).toHaveLength(1);
    expect(runtime.listeners('SIGINT')).toHaveLength(1);
    expect(runtime.listeners('uncaughtException')).toHaveLength(1);
    expect(runtime.listeners('unhandledRejection')).toHaveLength(1);
  });

  test('reuses the Winston logger across module reloads without adding process listeners', () => {
    const first = require('../src/utils/logger');
    const afterFirst = {
      uncaughtException: process.listeners('uncaughtException').length,
      unhandledRejection: process.listeners('unhandledRejection').length
    };
    jest.resetModules();
    const second = require('../src/utils/logger');

    expect(second).toBe(first);
    expect(process.listeners('uncaughtException')).toHaveLength(afterFirst.uncaughtException);
    expect(process.listeners('unhandledRejection')).toHaveLength(afterFirst.unhandledRejection);
  });

  test('loads without OPENAI_API_KEY', () => {
    delete process.env.OPENAI_API_KEY;
    jest.resetModules();
    jest.doMock('../src/services/teamManager', () => ({
      analyzeTeamWorkload: jest.fn()
    }));

    expect(() => {
      jest.isolateModules(() => {
        require('../src/services/conversationalAI');
      });
    }).not.toThrow();
  });
});
