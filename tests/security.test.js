const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const mongoose = require('mongoose');
const path = require('path');
const { safeExternalSourceUrl } = require('../src/utils/externalSourceUrl');

const {
  getPermissionsForRoles,
  hasPermission,
  createApiRateLimiter,
  requireApiAccess,
  requirePermission,
  verifyTrelloWebhook
} = require('../src/utils/requestSecurity');

const accountConnectorService = require('../src/services/accountConnectorService');
const enhancementBacklog = require('../src/services/enhancementBacklog');
const { getCategories, getConnectors } = require('../src/services/connectorRegistry');
const { NotificationService } = require('../src/services/notificationService');

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
    jest.dontMock('../src/models/AuditEvent');
    jest.dontMock('../src/services/workspaceScopeService');
    jest.dontMock('../src/services/operationsLedgerService');
    jest.dontMock('../src/services/policyRuleService');
    jest.dontMock('../src/services/githubWorkSignalClient');
    jest.dontMock('../src/services/trelloWorkSignalClient');
    jest.dontMock('../src/services/jiraWorkSignalClient');
    jest.dontMock('../src/services/harvestWorkSignalClient');
    jest.dontMock('../src/services/codaWorkSignalClient');
    jest.dontMock('../src/services/teamworkWorkSignalClient');
    jest.dontMock('../src/services/basecampWorkSignalClient');
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

  test('permits the configured local application origin while rejecting an untrusted origin', async () => {
    const originalPort = process.env.PORT;
    process.env.PORT = '3215';
    try {
      const requestSecurity = require('../src/utils/requestSecurity');
      await expect(new Promise((resolve, reject) => {
        requestSecurity.corsOptions.origin('http://127.0.0.1:3215', (error, allowed) => {
          if (error) return reject(error);
          return resolve(allowed);
        });
      })).resolves.toBe(true);
      await expect(new Promise((resolve, reject) => {
        requestSecurity.corsOptions.origin('https://untrusted.example', (error, allowed) => {
          if (error) return reject(error);
          return resolve(allowed);
        });
      })).rejects.toThrow('Origin is not allowed');
    } finally {
      if (originalPort === undefined) delete process.env.PORT;
      else process.env.PORT = originalPort;
    }
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

  test('allows only the exact invitation acceptance route without an existing API credential', async () => {
    delete process.env.SNEUP_API_KEY;
    process.env.SNEUP_REQUIRE_API_KEY = 'true';

    const req = createRequest({
      path: '/api/workspaces/invitations/accept',
      method: 'POST'
    });
    const res = createResponse();
    const next = jest.fn();

    await requireApiAccess(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth).toMatchObject({
      authenticated: true,
      authMethod: 'invite_acceptance',
      actorType: 'invite_recipient',
      actorId: 'pending-invite',
      roles: [],
      permissions: []
    });

    const invalidMethod = createRequest({
      path: '/api/workspaces/invitations/accept',
      method: 'GET'
    });
    const invalidMethodResponse = createResponse();
    await requireApiAccess(invalidMethod, invalidMethodResponse, jest.fn());
    expect(invalidMethodResponse.statusCode).toBe(503);
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
    expect(getPermissionsForRoles(['manager'])).toEqual(expect.arrayContaining([
      'notification-policies:manage',
      'notifications:dispatch',
      'policy-rules:manage'
    ]));
    expect(getPermissionsForRoles(['operator'])).not.toContain('jobs:manage');
    expect(getPermissionsForRoles(['admin'])).toContain('identity:manage');
    expect(hasPermission({ roles: ['manager'] }, 'approvals:decide')).toBe(true);
    expect(hasPermission({ roles: ['manager'] }, 'jobs:manage')).toBe(true);
    expect(hasPermission({ roles: ['manager'] }, 'notification-policies:manage')).toBe(true);
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

  test('requires audit read permission before returning ledger history', () => {
    jest.resetModules();
    jest.doMock('../src/services/operationsLedgerService', () => ({
      listAuditEvents: jest.fn()
    }));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      getRequestWorkspaceObjectId: jest.fn(() => 'workspace-1')
    }));

    const auditRoutes = require('../src/routes/audit');
    const route = auditRoutes.stack.find((layer) => layer.route?.path === '/').route;
    const guard = route.stack[0].handle;
    const next = jest.fn();
    const res = createResponse();

    guard(createRequest({ auth: { authenticated: true, roles: [], permissions: [] } }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.requiredPermission).toBe('audit:read');
  });

  test('requires audit read permission before returning a card operations ledger', () => {
    jest.resetModules();
    jest.doMock('../src/services/operationsLedgerService', () => ({
      getCardLedger: jest.fn()
    }));
    jest.doMock('../src/models/CardFinding', () => ({}));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      getRequestWorkspaceObjectId: jest.fn(() => 'workspace-1'),
      scopeQuery: jest.fn(() => ({}))
    }));

    const cardRoutes = require('../src/routes/cards');
    const route = cardRoutes.stack.find((layer) => layer.route?.path === '/:cardId/operations-ledger').route;
    const guard = route.stack[0].handle;
    const next = jest.fn();
    const res = createResponse();

    guard(createRequest({ auth: { authenticated: true, roles: [], permissions: [] } }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.requiredPermission).toBe('audit:read');
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

describe('external evidence URL boundary', () => {
  test('keeps only credential-free HTTPS source URLs', () => {
    expect(safeExternalSourceUrl('https://trello.com/c/abc123')).toBe('https://trello.com/c/abc123');
    expect(safeExternalSourceUrl('https://user:secret@trello.com/c/abc123')).toBeNull();
    expect(safeExternalSourceUrl('http://trello.com/c/abc123')).toBeNull();
    expect(safeExternalSourceUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalSourceUrl('not a URL')).toBeNull();
  });
});

describe('capacity-aware forecasting', () => {
  test('returns P50 and P80 delivery ranges with capacity assumptions and uncertainty risks', () => {
    const { buildForecast } = require('../src/services/forecastService');
    const now = new Date('2026-07-06T09:00:00.000Z');
    const forecast = buildForecast({
      now,
      boards: [{ _id: 'board-1', name: 'Launch' }],
      members: [{ _id: 'member-1', username: 'milan', fullName: 'Milan', averageCompletionTime: 5 }],
      profiles: [{
        _id: 'profile-1', memberId: 'member-1', weeklyHours: 32, allocationPercent: 75, focusHoursPerWeek: 4,
        timeOff: [{ startDate: '2026-07-13', endDate: '2026-07-14', label: 'Leave' }], skills: ['engineering']
      }],
      performances: [{ memberId: 'member-1', metrics: { averageCycleTime: 5 } }],
      cards: [
        { _id: 'card-1', boardId: 'board-1', members: ['member-1'], riskLevel: 'medium' },
        { _id: 'card-2', boardId: 'board-1', members: [], riskLevel: 'high', due: '2026-07-04T09:00:00.000Z' }
      ]
    });

    expect(forecast.portfolio).toMatchObject({
      boardName: 'Portfolio',
      openCards: 2,
      health: 'at_risk',
      confidenceLabel: expect.any(String)
    });
    expect(forecast.portfolio.p50.businessDays).toBeGreaterThan(0);
    expect(forecast.portfolio.p80.businessDays).toBeGreaterThanOrEqual(forecast.portfolio.p50.businessDays);
    expect(forecast.portfolio.risks.join(' ')).toContain('no accountable owner');
    expect(forecast.portfolio.assumptions.join(' ')).toContain('P80 adds');
    expect(forecast.memberCapacity[0]).toMatchObject({
      configured: true,
      allocationPercent: 75,
      timeOffHours: expect.any(Number),
      historicalCardHours: 5
    });
    expect(forecast.boards[0]).toMatchObject({ boardId: 'board-1', boardName: 'Launch' });
  });

  test('keeps a forecast directional when data is incomplete instead of inventing certainty', () => {
    const { buildForecast } = require('../src/services/forecastService');
    const forecast = buildForecast({
      now: new Date('2026-07-06T09:00:00.000Z'),
      boards: [{ _id: 'board-1', name: 'Launch' }],
      members: [],
      profiles: [],
      performances: [],
      cards: [{ _id: 'card-1', boardId: 'board-1', members: [], riskLevel: 'critical' }]
    });

    expect(forecast.portfolio.p50).toBeNull();
    expect(forecast.portfolio.p80).toBeNull();
    expect(forecast.portfolio.confidence).toBeLessThan(50);
    expect(forecast.portfolio.health).toBe('watch');
  });
});

describe('notification delivery safety', () => {
  const notificationService = new NotificationService();

  test('requires public HTTPS webhook destinations without embedded credentials or custom ports', () => {
    expect(notificationService.assertSafeWebhookUrl('https://hooks.slack.com/services/example')).toBe('https://hooks.slack.com/services/example');
    [
      'http://hooks.slack.com/services/example',
      'https://localhost/hook',
      'https://127.0.0.1/hook',
      'https://10.0.0.20/hook',
      'https://192.168.1.5/hook',
      'https://user:secret@example.com/hook',
      'https://example.com:8443/hook',
      'not a url'
    ].forEach((destination) => {
      expect(() => notificationService.assertSafeWebhookUrl(destination)).toThrow(/webhook/i);
    });
  });

  test('accepts one plain email recipient and keeps email policy payloads free of destination secrets', () => {
    expect(notificationService.assertSafeEmailAddress('operations@example.com')).toBe('operations@example.com');
    ['Operations <operations@example.com>', 'one@example.com, two@example.com', 'one@example.com\nBCC: two@example.com', 'not-an-email'].forEach((recipient) => {
      expect(() => notificationService.assertSafeEmailAddress(recipient)).toThrow(/email/i);
    });

    const emailPolicy = notificationService.normalizePolicyInput({ name: 'Operations email', channel: 'email' });
    expect(emailPolicy.channel).toBe('email');
    const payload = notificationService.buildEmailPayload({
      title: 'Sneup: critical reconciliation evidence gap',
      message: 'Move action needs operator evidence.',
      sourceUrl: 'https://trello.com/c/attempt-1',
      sourceEvidence: [{ label: 'Action evidence', url: 'https://trello.com/c/attempt-1' }]
    }, { from: 'alerts@example.com', recipient: 'operations@example.com' });
    expect(payload).toMatchObject({
      from: 'alerts@example.com',
      to: ['operations@example.com'],
      subject: 'Sneup: critical reconciliation evidence gap'
    });
    expect(payload.text).toContain('https://trello.com/c/attempt-1');
    expect(JSON.stringify(payload)).not.toContain('destinationEncrypted');
  });

  test('sends email through the fixed Resend endpoint with no redirect or proxy support', async () => {
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalSender = process.env.SNEUP_NOTIFICATION_EMAIL_FROM;
    const http = { post: jest.fn().mockResolvedValue({ status: 202 }) };
    const service = new NotificationService({ http });
    const decrypt = jest.spyOn(accountConnectorService, 'decrypt').mockReturnValue('operations@example.com');
    process.env.RESEND_API_KEY = 'resend_test_key_123456789';
    process.env.SNEUP_NOTIFICATION_EMAIL_FROM = 'alerts@example.com';

    try {
      await service.postEmail({ destinationEncrypted: 'ciphertext' }, {
        title: 'Sneup notification test',
        message: 'This confirms a policy can receive operational alerts.',
        sourceUrl: 'https://trello.com/c/attempt-1'
      });
      expect(http.post).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
        from: 'alerts@example.com',
        to: ['operations@example.com']
      }), expect.objectContaining({
        maxRedirects: 0,
        proxy: false,
        headers: expect.objectContaining({ Authorization: 'Bearer resend_test_key_123456789' })
      }));
    } finally {
      decrypt.mockRestore();
      if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalApiKey;
      if (originalSender === undefined) delete process.env.SNEUP_NOTIFICATION_EMAIL_FROM;
      else process.env.SNEUP_NOTIFICATION_EMAIL_FROM = originalSender;
    }
  });

  test('keeps destination data out of webhook payloads and uses provider-native payload shapes', () => {
    const event = {
      eventType: 'reconciliation_alert',
      severity: 'critical',
      title: 'Sneup: critical reconciliation evidence gap',
      message: 'Move action needs operator evidence.',
      sourceType: 'trello_action_attempt',
      sourceId: 'attempt-1',
      destinationEncrypted: 'never-send-this'
    };

    const slack = notificationService.buildWebhookPayload('slack_webhook', event);
    const generic = notificationService.buildWebhookPayload('generic_webhook', event);

    expect(slack).toEqual(expect.objectContaining({
      text: expect.stringContaining('critical reconciliation evidence gap'),
      unfurl_links: false
    }));
    expect(generic).toMatchObject({
      eventType: 'reconciliation_alert',
      severity: 'critical',
      sourceId: 'attempt-1'
    });
    expect(JSON.stringify(slack)).not.toContain('never-send-this');
    expect(JSON.stringify(generic)).not.toContain('never-send-this');
  });

  test('defers warning alerts in quiet hours without delaying critical evidence', () => {
    const policy = {
      quietHours: { enabled: true, startHourUtc: 18, endHourUtc: 8 }
    };

    expect(notificationService.isQuietHours(policy, '2026-07-14T19:00:00.000Z')).toBe(true);
    expect(notificationService.isQuietHours(policy, '2026-07-15T07:00:00.000Z')).toBe(true);
    expect(notificationService.isQuietHours(policy, '2026-07-15T12:00:00.000Z')).toBe(false);
    expect(notificationService.nextQuietHoursEnd(policy, '2026-07-14T19:00:00.000Z').toISOString())
      .toBe('2026-07-15T08:00:00.000Z');
    expect(() => notificationService.normalizePolicyInput({
      name: 'Operations alerts',
      channel: 'generic_webhook',
      destinationLabel: 'Operations',
      quietHours: { enabled: true, startHourUtc: 8, endHourUtc: 8 }
    })).toThrow(/quiet hours/i);
  });

  test('keeps warning digests bounded, scheduled, and linked only to safe evidence', () => {
    const policy = notificationService.normalizePolicyInput({
      name: 'Operations digest',
      channel: 'generic_webhook',
      digest: { enabled: true, hourUtc: 9, maximumItems: 2 }
    });
    const deliveries = [
      {
        _id: new mongoose.Types.ObjectId(),
        sourceType: 'trello_action_attempt',
        sourceId: 'attempt-1',
        title: 'First gap',
        message: 'First warning needs evidence.',
        sourceUrl: 'https://trello.com/c/first'
      },
      {
        _id: new mongoose.Types.ObjectId(),
        sourceType: 'trello_action_attempt',
        sourceId: 'attempt-2',
        title: 'Second gap',
        message: 'Second warning needs evidence.',
        sourceUrl: 'http://unsafe.test/second'
      }
    ];

    expect(notificationService.isDigestDue(policy, '2026-07-14T08:59:00.000Z')).toBe(false);
    expect(notificationService.isDigestDue(policy, '2026-07-14T09:00:00.000Z')).toBe(true);
    expect(notificationService.digestDedupeKey('2026-07-14T09:00:00.000Z')).toBe('reconciliation-digest:2026-07-14');
    expect(notificationService.buildDigestEvent(deliveries, 3, '2026-07-14T09:00:00.000Z')).toMatchObject({
      eventType: 'reconciliation_digest',
      severity: 'warning',
      dedupeKey: 'reconciliation-digest:2026-07-14',
      sourceEvidence: [{ label: 'First gap', url: 'https://trello.com/c/first' }]
    });
    expect(notificationService.buildWebhookPayload('generic_webhook', {
      eventType: 'reconciliation_digest',
      severity: 'warning',
      title: 'Digest',
      message: 'Review evidence.',
      sourceUrl: 'https://trello.com/c/first',
      sourceEvidence: [{ label: 'Safe', url: 'https://trello.com/c/first' }, { label: 'Unsafe', url: 'http://unsafe.test' }]
    })).toMatchObject({
      sourceUrl: 'https://trello.com/c/first',
      sourceEvidence: [{ label: 'Safe', url: 'https://trello.com/c/first' }]
    });
    expect(() => notificationService.normalizePolicyInput({
      name: 'Bad digest',
      channel: 'generic_webhook',
      digest: { enabled: true, hourUtc: 24, maximumItems: 50 }
    })).toThrow(/digest settings/i);
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
    expect(html).toContain('id="forecastsView"');
    expect(html).toContain('id="forecastBoards"');
    expect(appJs).toContain("fetchApi('/api/work-signals?limit=100')");
    expect(appJs).toContain('data-recommendation-evidence');
    expect(appJs).toContain('/api/recommendations/${recommendationId}/evidence');
    expect(appJs).toContain('PAYLOAD_REVIEW_FIELDS');
    expect(appJs).toContain('Review payload');
    expect(appJs).not.toContain('Edit payload JSON');
    expect(appJs).toContain('loadPayloadReviewContext');
    expect(appJs).toContain('New accountable owner');
    expect(appJs).toContain('Target Trello list');
    expect(appJs).toContain("fetchApi('/api/forecasts')");
    expect(appJs).toContain('Capacity and delivery forecasts');
    expect(appJs).toContain('data-graph-filter');
    expect(appJs).toContain('data-graph-dependency-review');
    expect(appJs).toContain('renderGraphReviewQuality(graph)');
    expect(appJs).toContain('provider retries');
    expect(appJs).toContain('data-connector-sync');
    expect(appJs).toContain('renderGraphLedgerFilters(graphContext)');
    expect(server).toContain("app.use('/api/work-signals', workSignalRoutes)");
    expect(server).toContain("app.use('/api/forecasts', forecastRoutes)");
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
    const WorkspaceInvite = require('../src/models/WorkspaceInvite');

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
    const rawInviteToken = WorkspaceInvite.generateRawToken();
    const invite = new WorkspaceInvite({
      workspaceId: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      email: 'invitee@example.com',
      displayName: 'Invitee',
      role: 'viewer',
      ...WorkspaceInvite.buildSecretRecord(rawInviteToken),
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
    expect(SessionToken.schema.path('revokedAt')).toBeTruthy();
    expect(SessionToken.schema.path('revokedBy')).toBeTruthy();
    expect(rawInviteToken).toMatch(/^sneup_invite_/);
    expect(invite.matches(rawInviteToken)).toBe(true);
    expect(invite.matches('wrong-invite')).toBe(false);
    expect(invite.isUsable()).toBe(true);
    expect(WorkspaceInvite.schema.path('tokenHash').options.select).toBe(false);
    expect(WorkspaceInvite.schema.path('delivery.status').enumValues).toEqual(expect.arrayContaining(['not_sent', 'sent', 'failed']));
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

  test('revokes a workspace-scoped session and records the high-risk audit event', async () => {
    jest.resetModules();

    const workspaceId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const sessionId = new mongoose.Types.ObjectId();
    const workspace = {
      _id: workspaceId,
      name: 'Operations',
      slug: 'operations',
      status: 'active',
      plan: 'team',
      settings: {}
    };
    const user = {
      _id: userId,
      workspaceId,
      displayName: 'Robert',
      role: 'owner',
      status: 'active',
      provider: 'local'
    };
    const session = {
      _id: sessionId,
      workspaceId,
      userId,
      name: 'Robert laptop',
      tokenPrefix: 'sneup_session_demo',
      status: 'active',
      expiresAt: new Date('2026-08-01T00:00:00Z'),
      createdAt: new Date('2026-07-01T00:00:00Z'),
      updatedAt: new Date('2026-07-01T00:00:00Z'),
      revoke: jest.fn(async (actor) => {
        session.status = 'revoked';
        session.revokedAt = new Date('2026-07-10T00:00:00Z');
        session.revokedBy = actor;
        return session;
      })
    };
    const recordAudit = jest.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

    jest.doMock('../src/models/Workspace', () => ({
      findOne: jest.fn().mockResolvedValue(workspace)
    }));
    jest.doMock('../src/models/User', () => ({
      findOne: jest.fn().mockResolvedValue(user)
    }));
    jest.doMock('../src/models/SessionToken', () => ({
      findOne: jest.fn().mockResolvedValue(session)
    }));
    jest.doMock('../src/services/operationsLedgerService', () => ({ recordAudit }));

    const router = require('../src/routes/workspaces');
    const revokeRoute = router.stack.find((layer) => layer.route?.path === '/:workspaceId/users/:userId/sessions/:sessionId/revoke');
    const handler = revokeRoute.route.stack.at(-1).handle;
    const res = {
      status: jest.fn(function status() { return this; }),
      json: jest.fn()
    };

    await handler({
      params: {
        workspaceId: String(workspaceId),
        userId: String(userId),
        sessionId: String(sessionId)
      },
      auth: { actorId: 'owner-1' }
    }, res);

    expect(session.revoke).toHaveBeenCalledWith('owner-1');
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      entityType: 'session_token',
      entityId: sessionId,
      action: 'workspace_user_session_revoked',
      riskLevel: 'high',
      beforeState: expect.objectContaining({ status: 'active' }),
      afterState: expect.objectContaining({ status: 'revoked', revokedBy: 'owner-1' })
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      session: expect.objectContaining({ status: 'revoked' })
    }));

    jest.dontMock('../src/models/Workspace');
    jest.dontMock('../src/models/User');
    jest.dontMock('../src/models/SessionToken');
    jest.dontMock('../src/services/operationsLedgerService');
    jest.resetModules();
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

  test('inspects workspace migration without writes and applies it with bounded concurrency', async () => {
    const workspaceScopeService = require('../src/services/workspaceScopeService');
    const workspaceId = new mongoose.Types.ObjectId();
    const models = [
      ['boards', { countDocuments: jest.fn().mockResolvedValue(2), updateMany: jest.fn().mockResolvedValue({ modifiedCount: 2 }) }],
      ['cards', { countDocuments: jest.fn().mockResolvedValue(3), updateMany: jest.fn().mockResolvedValue({ modifiedCount: 3 }) }],
      ['comments', { countDocuments: jest.fn().mockResolvedValue(0), updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }) }]
    ];

    const inspection = await workspaceScopeService.inspectDefaultWorkspaceBackfill({
      models,
      workspaceId,
      workspaceKey: 'production',
      concurrency: 2
    });

    expect(inspection).toMatchObject({
      mode: 'inspect',
      workspaceId: String(workspaceId),
      workspaceKey: 'production',
      concurrency: 2,
      collections: { boards: 2, cards: 3, comments: 0 },
      totalMissing: 5
    });
    models.forEach(([, Model]) => {
      expect(Model.countDocuments).toHaveBeenCalledWith({
        $or: [
          { workspaceId: { $exists: false } },
          { workspaceId: null }
        ]
      });
      expect(Model.updateMany).not.toHaveBeenCalled();
    });

    const ensureWorkspace = jest.fn().mockResolvedValue({ _id: workspaceId });
    const applied = await workspaceScopeService.backfillDefaultWorkspace({
      models,
      workspaceId,
      workspaceKey: 'production',
      concurrency: 2,
      ensureWorkspace
    });

    expect(ensureWorkspace).toHaveBeenCalledTimes(1);
    expect(applied).toMatchObject({
      mode: 'apply',
      workspaceId: String(workspaceId),
      workspaceKey: 'production',
      concurrency: 2,
      collections: { boards: 2, cards: 3, comments: 0 },
      totalModified: 5
    });
    models.forEach(([, Model]) => {
      expect(Model.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ $or: expect.any(Array) }),
        { $set: { workspaceId } }
      );
    });

    let activeWorkers = 0;
    let maxActiveWorkers = 0;
    const workerResults = await workspaceScopeService.mapWithConcurrency([1, 2, 3, 4], 2, async (item) => {
      activeWorkers += 1;
      maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
      await Promise.resolve();
      activeWorkers -= 1;
      return item * 2;
    });

    expect(workerResults).toEqual([2, 4, 6, 8]);
    expect(maxActiveWorkers).toBeLessThanOrEqual(2);
    expect(workspaceScopeService.getBackfillConcurrency('0')).toBe(1);
    expect(workspaceScopeService.getBackfillConcurrency('99')).toBe(16);
    expect(workspaceScopeService.getBackfillConcurrency('not-a-number')).toBe(4);
  });

  test('creates policy indexes when the legacy collection does not exist yet', async () => {
    const workspaceScopeService = require('../src/services/workspaceScopeService');
    const Model = {
      collection: {
        indexes: jest.fn().mockRejectedValue({ code: 26, codeName: 'NamespaceNotFound' }),
        dropIndex: jest.fn()
      },
      createIndexes: jest.fn().mockResolvedValue(undefined)
    };

    await expect(workspaceScopeService.ensurePolicyRuleIndexes({ Model })).resolves.toEqual({
      removedLegacyNameIndex: false
    });
    expect(Model.createIndexes).toHaveBeenCalledTimes(1);
    expect(Model.collection.dropIndex).not.toHaveBeenCalled();
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
      expect.arrayContaining(['trello', 'jira_software', 'asana', 'slack', 'github', 'notion', 'microsoft_365', 'linear'])
    );
  });

  test('does not request Microsoft 365 write scopes for read-only connector ingestion', () => {
    const microsoft = getConnectors().find(connector => connector.id === 'microsoft_365');

    expect(microsoft.auth.scopes).toEqual(expect.arrayContaining(['Calendars.Read', 'Tasks.Read', 'Files.Read']));
    expect(microsoft.auth.scopes).not.toEqual(expect.arrayContaining(['Mail.Read', 'Calendars.ReadWrite', 'Tasks.ReadWrite', 'Files.Read.All', 'Sites.Read.All']));
  });

  test('uses documented read-only scopes for Google Calendar, Zoom, Miro, and Google Chat', () => {
    const byId = Object.fromEntries(getConnectors().map(connector => [connector.id, connector]));

    expect(byId.google_workspace.auth.scopes).toContain('https://www.googleapis.com/auth/calendar.readonly');
    expect(byId.google_workspace.auth.scopes).not.toContain('https://www.googleapis.com/auth/calendar');
    expect(byId.zoom.auth.scopes).toEqual(expect.arrayContaining(['meeting:read', 'recording:read', 'user:read']));
    expect(byId.zoom.auth.scopes).not.toContain('meeting:write');
    expect(byId.miro.auth.scopes).toEqual(['boards:read', 'identity:read']);
    expect(byId.google_chat.auth.scopes).toEqual(['https://www.googleapis.com/auth/chat.messages.readonly']);
  });

  test('makes provider scope risk explicit and requires acknowledgement before credentials or OAuth leave Sneup', () => {
    const original = {
      state: process.env.CONNECTOR_STATE_SECRET,
      clientId: process.env.MIRO_CLIENT_ID,
      clientSecret: process.env.MIRO_CLIENT_SECRET
    };
    process.env.CONNECTOR_STATE_SECRET = 'connector-state-secret-for-scope-review-tests-123456';
    process.env.MIRO_CLIENT_ID = 'miro-client-id';
    process.env.MIRO_CLIENT_SECRET = 'miro-client-secret';

    try {
      const safety = accountConnectorService.getConnectorDetails('github').safety;
      expect(safety).toMatchObject({
        ingestion: 'read_only',
        providerWritesBlocked: true,
        scopeReviewRequired: true,
        providerScopeReviewRequired: true
      });

      const pendingReview = accountConnectorService.beginConnection('miro', { baseUrl: 'https://sneup.example' });
      expect(pendingReview).toMatchObject({ scopeReviewRequired: true });
      expect(pendingReview).not.toHaveProperty('authUrl');

      const approvedReview = accountConnectorService.beginConnection('miro', {
        baseUrl: 'https://sneup.example',
        scopeAcknowledged: true,
        actorId: 'operator-1'
      });
      expect(approvedReview.authUrl).toContain('https://miro.com/oauth/authorize');
      const signedState = new URL(approvedReview.authUrl).searchParams.get('state');
      expect(accountConnectorService.verifyState(signedState).consent).toMatchObject({
        version: 'scope-review-v1',
        acknowledgedBy: 'operator-1',
        requestedScopes: ['boards:read', 'identity:read'],
        scopeReviewRequired: true
      });
    } finally {
      process.env.CONNECTOR_STATE_SECRET = original.state;
      process.env.MIRO_CLIENT_ID = original.clientId;
      process.env.MIRO_CLIENT_SECRET = original.clientSecret;
    }
  });

  test('does not request Linear write scopes for read-only connector ingestion', () => {
    const linear = getConnectors().find(connector => connector.id === 'linear');

    expect(linear.auth.scopes).toEqual(['read']);
    expect(linear.auth.scopes).not.toEqual(expect.arrayContaining(['write', 'issues:create', 'comments:create', 'admin']));
  });

  test('requests only the monday.com board read scope for read-only connector ingestion', () => {
    const monday = getConnectors().find(connector => connector.id === 'monday');

    expect(monday.auth.scopes).toEqual(['boards:read']);
    expect(monday.auth.scopes).not.toEqual(expect.arrayContaining(['account:read', 'boards:write', 'users:read', 'updates:read', 'updates:write']));
  });

  test('requests only GitLab read scopes for read-only connector ingestion', () => {
    const gitlab = getConnectors().find(connector => connector.id === 'gitlab');

    expect(gitlab.auth.scopes).toEqual(['read_api', 'read_user']);
    expect(gitlab.auth.scopes).not.toEqual(expect.arrayContaining(['api', 'write_repository']));
  });

  test('does not add unsupported ClickUp OAuth scopes to the authorization request', () => {
    const clickup = getConnectors().find(connector => connector.id === 'clickup');

    expect(clickup.auth.scopes).toEqual([]);
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

  test('preserves non-secret connector scope consent while redacting credentials', () => {
    const account = accountConnectorService.sanitizeAccount({
      _id: 'account-consent-1',
      workspaceId: 'workspace-1',
      connectorId: 'miro',
      connectorName: 'Miro',
      category: 'collaboration',
      authType: 'oauth2',
      status: 'connected',
      scopes: ['boards:read', 'identity:read'],
      credentials: { accessToken: 'never-expose-this' },
      consent: {
        version: 'scope-review-v1',
        acknowledgedAt: '2026-07-14T00:00:00.000Z',
        acknowledgedBy: 'operator-1',
        requestedScopes: ['boards:read', 'identity:read'],
        scopeReviewRequired: true
      }
    });

    expect(account.consent).toEqual({
      version: 'scope-review-v1',
      acknowledgedAt: '2026-07-14T00:00:00.000Z',
      acknowledgedBy: 'operator-1',
      requestedScopes: ['boards:read', 'identity:read'],
      scopeReviewRequired: true
    });
    expect(account).not.toHaveProperty('credentials');
  });

  test('rotates token connector credentials in place with renewed consent and secret-free audit evidence', async () => {
    const originalEncryptionKey = process.env.CONNECTOR_ENCRYPTION_KEY;
    process.env.CONNECTOR_ENCRYPTION_KEY = 'connector-encryption-key-for-security-tests-123456';
    const account = {
      _id: 'account-rotation-1',
      workspaceId: 'workspace-1',
      connectorId: 'azure_devops',
      connectorName: 'Azure DevOps',
      category: 'software_delivery',
      authType: 'personal_access_token',
      status: 'failed',
      accountName: 'Delivery organization',
      externalAccountId: 'delivery',
      credentials: { apiKey: accountConnectorService.encrypt(JSON.stringify({ token: 'old-secret' })) },
      metadata: { fields: { organizationUrl: 'https://dev.azure.com/delivery' }, sync: ['projects', 'work_items'] },
      consent: { acknowledgedBy: 'previous-operator', scopeReviewRequired: true },
      lastError: 'Provider rejected the old token',
      save: jest.fn().mockResolvedValue(undefined)
    };
    const managedAccount = jest.spyOn(accountConnectorService, 'getManagedAccount').mockResolvedValue(account);
    const databaseReady = jest.spyOn(accountConnectorService, 'isDatabaseReady').mockReturnValue(true);
    const auditRotation = jest.spyOn(accountConnectorService, 'recordCredentialRotationAudit').mockResolvedValue(undefined);

    try {
      const rotated = await accountConnectorService.rotateCredentialAccount('account-rotation-1', {
        organizationUrl: 'https://dev.azure.com/delivery',
        token: 'new-secret',
        scopeAcknowledged: true
      }, { workspaceId: 'workspace-1', actorId: 'operator-1' });

      expect(accountConnectorService.getAccountCredentials(account)).toEqual({ token: 'new-secret' });
      expect(account.credentials.apiKey).not.toContain('old-secret');
      expect(account.status).toBe('connected');
      expect(account.lastError).toBeUndefined();
      expect(account.credentialsLastRotatedAt).toBeInstanceOf(Date);
      expect(rotated).not.toHaveProperty('credentials');
      expect(rotated.credentialsLastRotatedAt).toBe(account.credentialsLastRotatedAt);
      expect(auditRotation).toHaveBeenCalledWith(account, 'operator-1', expect.objectContaining({
        connectorId: 'azure_devops'
      }));
      expect(JSON.stringify(auditRotation.mock.calls[0])).not.toContain('new-secret');
      expect(JSON.stringify(auditRotation.mock.calls[0])).not.toContain('old-secret');
    } finally {
      managedAccount.mockRestore();
      databaseReady.mockRestore();
      auditRotation.mockRestore();
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

  test('lists Asana workspaces with an in-process token and persists only the selected workspace ID', async () => {
    const originalEncryptionKey = process.env.CONNECTOR_ENCRYPTION_KEY;
    process.env.CONNECTOR_ENCRYPTION_KEY = 'connector-encryption-key-for-security-tests-123456';
    const originalHttp = accountConnectorService.http;
    const get = jest.fn().mockResolvedValue({
      data: {
        data: [
          { gid: 'workspace-1001', name: 'Delivery', is_organization: true },
          { gid: 'workspace-1002', name: 'Personal', is_organization: false }
        ]
      }
    });
    accountConnectorService.http = { get };
    const account = {
      _id: 'account-2',
      workspaceId: 'workspace-1',
      connectorId: 'asana',
      connectorName: 'Asana',
      category: 'work_management',
      authType: 'oauth2',
      status: 'failed',
      credentials: { accessToken: accountConnectorService.encrypt('asana-token-value') },
      metadata: { fields: {} },
      save: jest.fn().mockResolvedValue(undefined)
    };
    const accountSpy = jest.spyOn(accountConnectorService, 'getManagedAccount').mockResolvedValue(account);

    try {
      const workspaces = await accountConnectorService.getAsanaWorkspaces('account-2', { workspaceId: 'workspace-1' });
      expect(workspaces).toEqual([
        { workspaceGid: 'workspace-1001', name: 'Delivery', organization: true },
        { workspaceGid: 'workspace-1002', name: 'Personal', organization: false }
      ]);
      expect(get).toHaveBeenCalledWith(
        'https://app.asana.com/api/1.0/workspaces',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer asana-token-value' }) })
      );

      const selected = await accountConnectorService.selectAsanaWorkspace('account-2', 'workspace-1001', { workspaceId: 'workspace-1' });
      expect(account.metadata.fields).toEqual({ asanaWorkspaceGid: 'workspace-1001' });
      expect(account.save).toHaveBeenCalledTimes(1);
      expect(selected.metadata.fields).toEqual({ asanaWorkspaceGid: 'workspace-1001' });
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
    jest.dontMock('../src/services/asanaWorkSignalClient');
    jest.dontMock('../src/services/slackWorkSignalClient');
    jest.dontMock('../src/services/googleWorkspaceWorkSignalClient');
    jest.dontMock('../src/services/clickupWorkSignalClient');
    jest.dontMock('../src/services/azureDevOpsWorkSignalClient');
    jest.dontMock('../src/services/wrikeWorkSignalClient');
    jest.dontMock('../src/services/smartsheetWorkSignalClient');
    jest.dontMock('../src/services/airtableWorkSignalClient');
    jest.dontMock('../src/services/todoistWorkSignalClient');
    jest.dontMock('../src/services/shortcutWorkSignalClient');
    jest.dontMock('../src/services/bitbucketWorkSignalClient');
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
    expect(notionContract.adapterStatus).toBe('implemented');
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
      'gitlab',
      'google_workspace',
      'microsoft_365',
      'linear',
      'notion',
      'monday',
      'clickup',
      'azure_devops'
    ]));
    expect(workSignalAdapterService.listAdapters().length).toBeGreaterThanOrEqual(13);
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

  test('GitLab adapter delegates live delta reads to its credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'issue:1' }] });
    jest.doMock('../src/services/gitlabWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'gitlab' };

    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('gitlab').capabilities.credentialBackedSync).toBe(true);
    jest.dontMock('../src/services/gitlabWorkSignalClient');
    jest.resetModules();
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

  test('Asana adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ gid: 'task-1' }] });
    jest.doMock('../src/services/asanaWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'asana' };

    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('asana').capabilities.credentialBackedSync).toBe(true);
  });

  test('Slack adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ ts: '1710000000.000001' }] });
    jest.doMock('../src/services/slackWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'slack' };

    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('slack').capabilities.credentialBackedSync).toBe(true);
  });

  test('Google Workspace adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'event-1' }] });
    jest.doMock('../src/services/googleWorkspaceWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'google_workspace' };

    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('google_workspace').capabilities.credentialBackedSync).toBe(true);
  });

  test('Microsoft 365 adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'event-1' }] });
    jest.doMock('../src/services/microsoft365WorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'microsoft_365' };

    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('microsoft_365').capabilities.credentialBackedSync).toBe(true);
  });

  test('Linear adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'issue-1' }] });
    jest.doMock('../src/services/linearWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'linear' };

    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('linear').capabilities.credentialBackedSync).toBe(true);
  });

  test('Notion adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'page-1' }] });
    jest.doMock('../src/services/notionWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'notion' };

    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('notion').capabilities.credentialBackedSync).toBe(true);
  });

  test('monday.com adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'item-1' }] });
    jest.doMock('../src/services/mondayWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'monday' };

    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('monday').capabilities.credentialBackedSync).toBe(true);
  });

  test('ClickUp adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'task-1' }] });
    jest.doMock('../src/services/clickupWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'clickup' };

    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('clickup').capabilities.credentialBackedSync).toBe(true);
  });

  test('Azure DevOps adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: '42' }] });
    jest.doMock('../src/services/azureDevOpsWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'azure_devops' };

    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('azure_devops').capabilities.credentialBackedSync).toBe(true);
  });

  test('Wrike adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'task-1' }] });
    jest.doMock('../src/services/wrikeWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'wrike' };

    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('wrike').capabilities.credentialBackedSync).toBe(true);
  });

  test('Smartsheet adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'row-1' }] });
    jest.doMock('../src/services/smartsheetWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'smartsheet' };

    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('smartsheet').capabilities.credentialBackedSync).toBe(true);
  });

  test('Airtable adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'rec-1' }] });
    jest.doMock('../src/services/airtableWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'airtable' };
    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');
    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('airtable').capabilities.credentialBackedSync).toBe(true);
  });

  test('Todoist adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'task-1' }] });
    jest.doMock('../src/services/todoistWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const result = await workSignalAdapterService.fetchDelta({ connectorId: 'todoist' }, '2026-07-01T00:00:00.000Z');
    expect(fetchDelta).toHaveBeenCalledWith({ connectorId: 'todoist' }, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
  });

  test('Shortcut adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'story-1' }] });
    jest.doMock('../src/services/shortcutWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'shortcut' };
    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');
    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('shortcut').capabilities.credentialBackedSync).toBe(true);
  });

  test('Bitbucket adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'issue:1' }] });
    jest.doMock('../src/services/bitbucketWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'bitbucket' };
    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');
    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('bitbucket').capabilities.credentialBackedSync).toBe(true);
  });

  test('Harvest adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'time_entry:1' }] });
    jest.doMock('../src/services/harvestWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'harvest' };
    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');
    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('harvest').capabilities.credentialBackedSync).toBe(true);
  });

  test('Teamwork adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'task:1' }] });
    jest.doMock('../src/services/teamworkWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'teamwork' };
    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');
    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('teamwork').capabilities.credentialBackedSync).toBe(true);
  });

  test('Basecamp adapter delegates live delta reads to the credential-backed client', async () => {
    jest.resetModules();
    const fetchDelta = jest.fn().mockResolvedValue({ records: [{ id: 'todo:1' }] });
    jest.doMock('../src/services/basecampWorkSignalClient', () => ({ fetchDelta }));
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'basecamp' };
    const result = await workSignalAdapterService.fetchDelta(account, '2026-07-01T00:00:00.000Z');
    expect(fetchDelta).toHaveBeenCalledWith(account, '2026-07-01T00:00:00.000Z');
    expect(result.records).toHaveLength(1);
    expect(workSignalAdapterService.getAdapter('basecamp').capabilities.credentialBackedSync).toBe(true);
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

  test('GitLab API sync reads bounded issue and merge-request metadata with read-only OAuth access', async () => {
    const { GitLabWorkSignalClient } = require('../src/services/gitlabWorkSignalClient');
    const http = {
      get: jest.fn()
        .mockResolvedValueOnce({
          data: [{
            id: 17,
            title: 'Coordinate release owner',
            description: 'Private issue content must not enter Sneup.',
            state: 'opened',
            labels: ['P1', 'release'],
            author: { id: 1, username: 'robert', name: 'Robert' },
            assignees: [{ id: 2, username: 'nina', name: 'Nina' }],
            project_id: 42,
            due_date: '2026-07-15',
            created_at: '2026-07-09T09:00:00.000Z',
            updated_at: '2026-07-10T10:00:00.000Z',
            web_url: 'https://gitlab.com/noodzakelijk/sneup/-/issues/17'
          }],
          headers: { 'x-next-page': '' }
        })
        .mockResolvedValueOnce({
          data: [{
            id: 18,
            title: 'Review connector release',
            description: 'Private merge-request content must not enter Sneup.',
            state: 'opened',
            draft: true,
            labels: ['backend'],
            author: { id: 1, username: 'robert', name: 'Robert' },
            reviewers: [{ id: 3, username: 'milan', name: 'Milan' }],
            project_id: 42,
            created_at: '2026-07-09T11:00:00.000Z',
            updated_at: '2026-07-10T12:00:00.000Z',
            web_url: 'https://gitlab.com/noodzakelijk/sneup/-/merge_requests/18'
          }],
          headers: { 'x-next-page': '' }
        })
    };
    const client = new GitLabWorkSignalClient({
      http,
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ accessToken: 'gitlab-access-token' })) }
    });
    const originalEnv = { ...process.env };
    process.env.SNEUP_GITLAB_MAX_ITEMS = '20';
    process.env.SNEUP_GITLAB_PAGE_SIZE = '10';
    process.env.SNEUP_GITLAB_CURSOR_LOOKBACK_MS = '60000';

    try {
      const result = await client.fetchDelta({ connectorId: 'gitlab' }, '2026-07-10T09:59:00.000Z');

      expect(http.get).toHaveBeenCalledTimes(2);
      expect(http.get.mock.calls.map(call => call[0])).toEqual([
        'https://gitlab.com/api/v4/issues',
        'https://gitlab.com/api/v4/merge_requests'
      ]);
      expect(http.get.mock.calls[0][1]).toMatchObject({
        params: expect.objectContaining({
          scope: 'all', state: 'all', order_by: 'updated_at', sort: 'desc', per_page: 10,
          updated_after: '2026-07-10T09:58:00.000Z'
        }),
        headers: { Accept: 'application/json', Authorization: 'Bearer gitlab-access-token' }
      });
      const requested = http.get.mock.calls.map(call => `${call[0]} ${JSON.stringify(call[1]?.params || {})}`).join(' ');
      expect(requested).not.toMatch(/description|notes|diff|repository_files|content/i);
      expect(result).toMatchObject({
        nextCursor: '2026-07-10T12:00:00.000Z',
        hasMore: false,
        metadata: { source: 'gitlab_api', issues: 1, mergeRequests: 1, items: 2 }
      });
      expect(result.records).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'issue:17', sourceType: 'issue', title: 'Coordinate release owner' }),
        expect.objectContaining({ id: 'merge_request:18', sourceType: 'pull_request', title: 'Review connector release' })
      ]));
      expect(result.records[0]).not.toHaveProperty('description');
    } finally {
      process.env = originalEnv;
    }
  });

  test('GitLab normalization preserves work metadata without provider descriptions', () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const normalized = workSignalAdapterService.normalize({ connectorId: 'gitlab' }, {
      id: 'merge_request:18',
      gitlabSource: 'merge_request',
      title: 'Review connector release',
      state: 'opened',
      labels: ['P1', 'backend'],
      author: { username: 'robert' },
      reviewers: [{ username: 'milan' }],
      webUrl: 'https://gitlab.com/noodzakelijk/sneup/-/merge_requests/18',
      updatedAt: '2026-07-10T12:00:00.000Z'
    });

    expect(normalized).toMatchObject({
      externalId: 'merge_request:18',
      sourceType: 'pull_request',
      description: '',
      status: 'open',
      priority: 'high',
      owners: ['milan', 'robert'],
      labels: ['P1', 'backend']
    });
    expect(normalized.raw).not.toHaveProperty('description');
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

  test('Asana API sync reads a selected workspace through bounded project task requests', async () => {
    const { AsanaWorkSignalClient } = require('../src/services/asanaWorkSignalClient');
    const http = {
      get: jest.fn()
        .mockResolvedValueOnce({
          data: { data: [{ gid: 'workspace-1', name: 'Delivery', is_organization: true }] }
        })
        .mockResolvedValueOnce({
          data: { data: [{ gid: 'project-1', name: 'Launch', permalink_url: 'https://app.asana.com/0/project-1/list' }] }
        })
        .mockResolvedValueOnce({
          data: {
            data: [{
              gid: 'task-1',
              name: 'Approve launch plan',
              modified_at: '2026-07-09T12:00:00.000Z',
              completed: false,
              dependencies: [{ gid: 'task-0' }],
              permalink_url: 'https://app.asana.com/0/task-1'
            }]
          }
        })
    };
    const credentials = {
      getAccountCredentials: jest.fn(() => ({ accessToken: 'asana-access-token' }))
    };
    const client = new AsanaWorkSignalClient({
      http,
      accountConnectorService: credentials,
      now: () => new Date('2026-07-10T00:00:00.000Z')
    });
    const originalEnv = { ...process.env };
    process.env.SNEUP_ASANA_MAX_PROJECTS = '10';
    process.env.SNEUP_ASANA_MAX_TASKS_PER_PROJECT = '100';
    process.env.SNEUP_ASANA_MAX_TOTAL_TASKS = '100';
    process.env.SNEUP_ASANA_CURSOR_LOOKBACK_MS = '60000';

    try {
      const result = await client.fetchDelta({ connectorId: 'asana', metadata: { fields: { asanaWorkspaceGid: 'workspace-1' } } }, '2026-07-09T11:30:00.000Z');

      expect(http.get).toHaveBeenCalledTimes(3);
      expect(http.get.mock.calls[0][0]).toBe('https://app.asana.com/api/1.0/workspaces');
      expect(http.get.mock.calls[1][0]).toBe('https://app.asana.com/api/1.0/workspaces/workspace-1/projects');
      expect(http.get.mock.calls[2][0]).toBe('https://app.asana.com/api/1.0/projects/project-1/tasks');
      expect(http.get.mock.calls[2][1].params).toMatchObject({
        limit: 100,
        modified_since: '2026-07-09T11:29:00.000Z',
        completed_since: '2026-07-09T11:29:00.000Z'
      });
      expect(result).toMatchObject({
        nextCursor: '2026-07-09T12:00:00.000Z',
        hasMore: false,
        metadata: { source: 'asana_api', workspaces: 1, projects: 1, workspaceGid: 'workspace-1' }
      });
      expect(result.records[0]).toMatchObject({
        gid: 'task-1',
        project: { gid: 'project-1', name: 'Launch' },
        workspace: { gid: 'workspace-1', name: 'Delivery' }
      });
    } finally {
      process.env = originalEnv;
    }
  });

  test('Asana sync rejects ambiguous multi-workspace access instead of choosing a workspace', () => {
    const { AsanaWorkSignalClient } = require('../src/services/asanaWorkSignalClient');
    const client = new AsanaWorkSignalClient({ accountConnectorService: {} });

    expect(() => client.selectWorkspace({}, [
      { gid: 'workspace-1', name: 'One' },
      { gid: 'workspace-2', name: 'Two' }
    ])).toThrow('multiple workspaces');
    try {
      client.selectWorkspace({}, [{ gid: 'workspace-1' }, { gid: 'workspace-2' }]);
    } catch (error) {
      expect(error.statusCode).toBe(409);
    }
  });

  test('Slack API sync reads bounded channel history without using a message-posting endpoint', async () => {
    const { SlackWorkSignalClient } = require('../src/services/slackWorkSignalClient');
    const http = {
      get: jest.fn().mockResolvedValue({
        data: {
          ok: true,
          channels: [{ id: 'C123', name: 'launch', is_private: false }]
        }
      }),
      post: jest.fn()
        .mockResolvedValueOnce({
          data: { ok: true, team_id: 'T123', team: 'Sneup', url: 'https://sneup.slack.com/' }
        })
        .mockResolvedValueOnce({
          data: {
            ok: true,
            messages: [{ type: 'message', user: 'U123', text: 'Launch owner needed', ts: '1783512000.000001' }]
          }
        })
    };
    const credentials = {
      getAccountCredentials: jest.fn(() => ({ accessToken: 'slack-access-token' }))
    };
    const client = new SlackWorkSignalClient({ http, accountConnectorService: credentials });
    const originalEnv = { ...process.env };
    process.env.SNEUP_SLACK_MAX_CHANNELS = '5';
    process.env.SNEUP_SLACK_MAX_MESSAGES_PER_CHANNEL = '15';
    process.env.SNEUP_SLACK_MAX_TOTAL_MESSAGES = '30';
    process.env.SNEUP_SLACK_CURSOR_LOOKBACK_MS = '60000';

    try {
      const result = await client.fetchDelta({ connectorId: 'slack' }, '2026-07-08T11:59:00.000Z');

      expect(http.get).toHaveBeenCalledWith(
        'https://slack.com/api/conversations.list',
        expect.objectContaining({
          params: expect.objectContaining({ limit: 5, types: 'public_channel,private_channel', exclude_archived: true }),
          headers: expect.objectContaining({ Authorization: 'Bearer slack-access-token' })
        })
      );
      expect(http.post.mock.calls[0][0]).toBe('https://slack.com/api/auth.test');
      expect(http.post.mock.calls[1][0]).toBe('https://slack.com/api/conversations.history');
      expect(http.post.mock.calls[1][1]).toMatchObject({ channel: 'C123', limit: 15, oldest: '1783511880' });
      expect(http.post.mock.calls.map(call => call[0])).not.toContain('https://slack.com/api/chat.postMessage');
      expect(result).toMatchObject({
        nextCursor: '2026-07-08T12:00:00.000Z',
        hasMore: false,
        metadata: { source: 'slack_api', channels: 1, teamId: 'T123' }
      });
      expect(result.records[0]).toMatchObject({
        text: 'Launch owner needed',
        url: 'https://sneup.slack.com/archives/C123/p1783512000000001',
        channel: { id: 'C123', name: 'launch' }
      });
    } finally {
      process.env = originalEnv;
    }
  });

  test('Google Workspace sync reads Calendar events and Drive metadata without file-content endpoints', async () => {
    const { GoogleWorkspaceWorkSignalClient } = require('../src/services/googleWorkspaceWorkSignalClient');
    const http = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: { items: [{ id: 'primary', summary: 'Primary' }] } })
        .mockResolvedValueOnce({ data: { files: [{ id: 'file-1', name: 'Launch brief', mimeType: 'application/pdf', modifiedTime: '2026-07-08T12:00:00.000Z' }] } })
        .mockResolvedValueOnce({ data: { items: [{ id: 'event-1', summary: 'Launch review', updated: '2026-07-08T13:00:00.000Z', start: { dateTime: '2026-07-09T09:00:00Z' } }] } })
    };
    const client = new GoogleWorkspaceWorkSignalClient({
      http,
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ accessToken: 'google-access-token' })) },
      now: () => new Date('2026-07-08T10:00:00.000Z')
    });

    const result = await client.fetchDelta({ connectorId: 'google_workspace' }, '2026-07-08T11:00:00.000Z');

    expect(http.get.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      'https://www.googleapis.com/drive/v3/files',
      'https://www.googleapis.com/calendar/v3/calendars/primary/events'
    ]));
    expect(http.get.mock.calls.map(call => call[0]).join(' ')).not.toMatch(/download|export|alt=media|gmail/i);
    expect(http.get.mock.calls[1][1].params.fields).toContain('mimeType');
    expect(result).toMatchObject({
      nextCursor: '2026-07-08T13:00:00.000Z',
      metadata: { source: 'google_workspace_api', calendars: 1, files: 1 }
    });
    expect(result.records).toHaveLength(2);
  });

  test('Google Workspace normalization separates Calendar and Drive identifier namespaces', () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'google_workspace' };

    const event = workSignalAdapterService.normalize(account, {
      id: 'same-id',
      start: { dateTime: '2026-07-08T10:00:00Z' },
      calendar: { id: 'primary' }
    });
    const file = workSignalAdapterService.normalize(account, { id: 'same-id', mimeType: 'application/pdf' });

    expect(event.externalId).toBe('calendar:primary:same-id');
    expect(file.externalId).toBe('drive:same-id');
  });

  test('Microsoft 365 sync reads bounded Calendar, To Do, and OneDrive metadata without mail, content, or provider writes', async () => {
    jest.dontMock('../src/services/microsoft365WorkSignalClient');
    jest.resetModules();
    const { Microsoft365WorkSignalClient } = require('../src/services/microsoft365WorkSignalClient');
    const http = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: { value: [{ id: 'same-id', subject: 'Launch review', start: { dateTime: '2026-07-09T09:00:00Z' }, end: { dateTime: '2026-07-09T10:00:00Z' }, lastModifiedDateTime: '2026-07-08T13:00:00.000Z' }] } })
        .mockResolvedValueOnce({ data: { value: [{ id: 'tasks', displayName: 'Tasks' }] } })
        .mockResolvedValueOnce({ data: { value: [{ id: 'same-id', name: 'Launch brief', file: {}, lastModifiedDateTime: '2026-07-08T12:00:00.000Z' }] } })
        .mockResolvedValueOnce({ data: { value: [{ id: 'same-id', title: 'Approve launch brief', status: 'notStarted', lastModifiedDateTime: '2026-07-08T12:30:00.000Z' }] } })
    };
    const client = new Microsoft365WorkSignalClient({
      http,
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ accessToken: 'microsoft-access-token' })) }
    });

    const result = await client.fetchDelta({ connectorId: 'microsoft_365' }, '2026-07-08T11:00:00.000Z');

    expect(http.get.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([
      'https://graph.microsoft.com/v1.0/me/events',
      'https://graph.microsoft.com/v1.0/me/todo/lists',
      'https://graph.microsoft.com/v1.0/me/drive/root/children',
      'https://graph.microsoft.com/v1.0/me/todo/lists/tasks/tasks'
    ]));
    const requested = http.get.mock.calls.map(call => `${call[0]} ${JSON.stringify(call[1]?.params || {})}`).join(' ');
    expect(requested).not.toMatch(/mail|messages|content|download|export|\$value|bodyPreview/i);
    expect(http.get.mock.calls.map(call => Object.keys(call[1]?.headers || {})).flat()).not.toContain('Content-Type');
    expect(result).toMatchObject({
      nextCursor: '2026-07-08T13:00:00.000Z',
      hasMore: false,
      metadata: { source: 'microsoft_graph', events: 1, taskLists: 1, todoTasks: 1, files: 1 }
    });
    expect(result.records.map(record => record.microsoftSource)).toEqual(expect.arrayContaining(['calendar', 'todo', 'onedrive']));
  });

  test('Microsoft 365 normalization separates Calendar, To Do, and OneDrive identifier namespaces', () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const account = { connectorId: 'microsoft_365' };

    const event = workSignalAdapterService.normalize(account, { id: 'same-id', microsoftSource: 'calendar', start: { dateTime: '2026-07-08T10:00:00Z' } });
    const task = workSignalAdapterService.normalize(account, { id: 'same-id', microsoftSource: 'todo', todoList: { id: 'tasks' } });
    const file = workSignalAdapterService.normalize(account, { id: 'same-id', microsoftSource: 'onedrive', file: {} });

    expect(event.externalId).toBe('calendar:same-id');
    expect(task.externalId).toBe('todo:tasks:same-id');
    expect(file.externalId).toBe('onedrive:same-id');
  });

  test('Linear sync reads bounded issue pages with GraphQL query-only requests', async () => {
    jest.dontMock('../src/services/linearWorkSignalClient');
    jest.resetModules();
    const { LinearWorkSignalClient } = require('../src/services/linearWorkSignalClient');
    const http = {
      post: jest.fn().mockResolvedValue({
        data: {
          data: {
            issues: {
              nodes: [{
                id: 'issue-1',
                identifier: 'SNEUP-9',
                title: 'Ship Linear sync',
                priority: 2,
                state: { name: 'In Progress', type: 'started' },
                labels: { nodes: [{ name: 'connector' }] },
                assignee: { name: 'Robert' },
                updatedAt: '2026-07-09T12:00:00.000Z'
              }],
              pageInfo: { hasNextPage: false, endCursor: null }
            }
          }
        }
      })
    };
    const client = new LinearWorkSignalClient({
      http,
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ accessToken: 'linear-access-token' })) }
    });

    const result = await client.fetchDelta({ connectorId: 'linear' }, '2026-07-09T11:00:00.000Z');

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      'https://api.linear.app/graphql',
      expect.objectContaining({ query: expect.stringContaining('query SneupWorkSignals') }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer linear-access-token' }) })
    );
    const request = http.post.mock.calls[0][1];
    expect(request.query).not.toMatch(/mutation|issueCreate|issueUpdate/i);
    expect(request.variables).toEqual({ first: 100, after: null });
    expect(result).toMatchObject({
      nextCursor: '2026-07-09T12:00:00.000Z',
      hasMore: false,
      metadata: { source: 'linear_graphql', issues: 1 }
    });
  });

  test('Linear normalization preserves issue status, priority, and project context', () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const normalized = workSignalAdapterService.normalize({ connectorId: 'linear' }, {
      id: 'issue-1',
      identifier: 'SNEUP-9',
      title: 'Ship Linear sync',
      priority: 2,
      state: { name: 'In Progress', type: 'started' },
      assignee: { name: 'Robert' },
      labels: { nodes: [{ name: 'connector' }] },
      project: { name: 'Connector hub' },
      updatedAt: '2026-07-09T12:00:00.000Z'
    });

    expect(normalized).toMatchObject({
      externalId: 'issue-1',
      sourceType: 'issue',
      status: 'in_progress',
      priority: 'high',
      owners: ['Robert'],
      labels: ['connector']
    });
    expect(normalized.raw.project.name).toBe('Connector hub');
  });

  test('Notion sync reads bounded shared page and data-source metadata without page content or comments', async () => {
    jest.dontMock('../src/services/notionWorkSignalClient');
    jest.resetModules();
    const { NotionWorkSignalClient } = require('../src/services/notionWorkSignalClient');
    const http = {
      post: jest.fn().mockResolvedValue({
        data: {
          results: [
            {
              object: 'page',
              id: 'page-1',
              url: 'https://www.notion.so/page-1',
              created_time: '2026-07-09T09:00:00.000Z',
              last_edited_time: '2026-07-09T12:00:00.000Z',
              properties: { Name: { type: 'title', title: [{ plain_text: 'Launch brief' }] } }
            },
            {
              object: 'data_source',
              id: 'source-1',
              title: [{ plain_text: 'Project tracker' }],
              last_edited_time: '2026-07-09T11:00:00.000Z'
            }
          ],
          has_more: false,
          next_cursor: null
        }
      })
    };
    const client = new NotionWorkSignalClient({
      http,
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ accessToken: 'notion-access-token' })) }
    });

    const result = await client.fetchDelta({ connectorId: 'notion' }, '2026-07-09T10:00:00.000Z');

    expect(http.post).toHaveBeenCalledWith(
      'https://api.notion.com/v1/search',
      expect.objectContaining({ page_size: 100, sort: { direction: 'descending', timestamp: 'last_edited_time' } }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer notion-access-token', 'Notion-Version': '2026-03-11' }) })
    );
    expect(http.post.mock.calls.map(call => call[0]).join(' ')).not.toMatch(/blocks|comments|retrieve|content/i);
    expect(result).toMatchObject({
      nextCursor: '2026-07-09T12:00:00.000Z',
      hasMore: false,
      metadata: { source: 'notion_api', pages: 1, dataSources: 1 }
    });
  });

  test('Notion normalization extracts title metadata without interpreting page content', () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const normalized = workSignalAdapterService.normalize({ connectorId: 'notion' }, {
      object: 'page',
      id: 'page-1',
      url: 'https://www.notion.so/page-1',
      last_edited_time: '2026-07-09T12:00:00.000Z',
      properties: { Name: { type: 'title', title: [{ plain_text: 'Launch brief' }] } }
    });

    expect(normalized).toMatchObject({
      externalId: 'page:page-1',
      sourceType: 'document',
      title: 'Launch brief',
      description: '',
      status: 'open',
      url: 'https://www.notion.so/page-1'
    });
  });

  test('monday.com sync reads bounded board and item metadata with GraphQL query-only requests', async () => {
    jest.dontMock('../src/services/mondayWorkSignalClient');
    jest.resetModules();
    const { MondayWorkSignalClient } = require('../src/services/mondayWorkSignalClient');
    const http = {
      post: jest.fn()
        .mockResolvedValueOnce({
          data: { data: { boards: [{ id: 'board-1', name: 'Launch', url: 'https://monday.com/board-1', state: 'active', updated_at: '2026-07-09T12:00:00.000Z' }] } }
        })
        .mockResolvedValueOnce({
          data: { data: { boards: [{ id: 'board-1', name: 'Launch', url: 'https://monday.com/board-1', items_page: {
            cursor: null,
            items: [{
              id: 'item-1', name: 'Ship connector', url: 'https://monday.com/item-1', created_at: '2026-07-09T09:00:00.000Z', updated_at: '2026-07-09T12:00:00.000Z',
              group: { id: 'group-1', title: 'In progress' },
              column_values: [{ id: 'status', type: 'color', text: 'In Progress' }, { id: 'priority', type: 'color', text: 'High' }, { id: 'owner', type: 'people', text: 'Robert' }]
            }]
          } }] } }
        })
    };
    const client = new MondayWorkSignalClient({
      http,
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ accessToken: 'monday-access-token' })) }
    });

    const result = await client.fetchDelta({ connectorId: 'monday' }, '2026-07-09T11:00:00.000Z');

    expect(http.post).toHaveBeenCalledTimes(2);
    expect(http.post).toHaveBeenCalledWith(
      'https://api.monday.com/v2',
      expect.objectContaining({ query: expect.stringContaining('query SneupMondayBoards') }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'monday-access-token', 'API-Version': '2025-10' }) })
    );
    const queries = http.post.mock.calls.map(call => call[1].query).join(' ');
    expect(queries).not.toMatch(/mutation|create_|change_|delete_|update_/i);
    expect(queries).not.toMatch(/updates|description|assets|file/i);
    expect(result).toMatchObject({
      nextCursor: '2026-07-09T12:00:00.000Z',
      hasMore: false,
      metadata: { source: 'monday_api', boards: 1, items: 1 }
    });
  });

  test('monday.com normalization preserves board context without item descriptions', () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const normalized = workSignalAdapterService.normalize({ connectorId: 'monday' }, {
      id: 'item-1', name: 'Ship connector', url: 'https://monday.com/item-1', created_at: '2026-07-09T09:00:00.000Z', updated_at: '2026-07-09T12:00:00.000Z',
      board: { id: 'board-1', name: 'Launch' }, group: { title: 'In progress' },
      column_values: [{ type: 'color', text: 'In Progress' }, { type: 'color', text: 'High' }, { type: 'people', text: 'Robert' }]
    });

    expect(normalized).toMatchObject({
      externalId: 'board:board-1:item-1', sourceType: 'task', title: 'Ship connector', description: '', status: 'in_progress', priority: 'high', owners: ['Robert'], labels: ['Launch', 'In progress']
    });
  });

  test('ClickUp sync reads bounded workspace task pages and strips descriptions before storage', async () => {
    jest.dontMock('../src/services/clickupWorkSignalClient');
    jest.resetModules();
    const { ClickUpWorkSignalClient } = require('../src/services/clickupWorkSignalClient');
    const http = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: { teams: [{ id: 'team-1', name: 'Sneup workspace' }] } })
        .mockResolvedValueOnce({ data: {
          tasks: [{
            id: 'task-1', name: 'Ship ClickUp sync', description: 'Private project detail', markdown_description: 'Private markdown detail', url: 'https://app.clickup.com/t/task-1',
            status: { status: 'in progress' }, priority: { priority: '2' }, assignees: [{ username: 'Robert' }], tags: [{ name: 'connector' }],
            due_date: '1783209600000', date_created: '1783036800000', date_updated: '1783123200000', dependencies: [{ task_id: 'task-1', depends_on: 'task-0' }],
            space: { name: 'Platform' }, folder: { name: 'Delivery' }, list: { name: 'Connector work' }
          }],
          last_page: true
        } })
    };
    const client = new ClickUpWorkSignalClient({
      http,
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ accessToken: 'clickup-access-token' })) }
    });

    const result = await client.fetchDelta({ connectorId: 'clickup' }, '2026-07-01T00:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/team',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer clickup-access-token' }) })
    );
    expect(http.get).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/team/team-1/task',
      expect.objectContaining({ params: expect.objectContaining({ order_by: 'updated', reverse: true, include_closed: true, subtasks: true }) })
    );
    const requested = http.get.mock.calls.map(call => `${call[0]} ${JSON.stringify(call[1]?.params || {})}`).join(' ');
    expect(requested).not.toMatch(/comment|create|delete|markdown_description|attachment/i);
    expect(result.records[0]).not.toHaveProperty('description');
    expect(result.records[0]).not.toHaveProperty('markdown_description');
    expect(result).toMatchObject({ metadata: { source: 'clickup_api', workspaces: 1, items: 1 }, hasMore: false });
  });

  test('ClickUp normalization preserves status, priority, owners, and workspace hierarchy without task descriptions', () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const normalized = workSignalAdapterService.normalize({ connectorId: 'clickup' }, {
      id: 'task-1', name: 'Ship ClickUp sync', url: 'https://app.clickup.com/t/task-1', status: { status: 'in progress' }, priority: { priority: '2' },
      assignees: [{ username: 'Robert' }], tags: [{ name: 'connector' }], team: { id: 'team-1', name: 'Sneup workspace' }, space: { name: 'Platform' }, folder: { name: 'Delivery' }, list: { name: 'Connector work' }, date_updated: '1783123200000'
    });

    expect(normalized).toMatchObject({
      externalId: 'workspace:team-1:task:task-1', sourceType: 'task', title: 'Ship ClickUp sync', description: '', status: 'in_progress', priority: 'high', owners: ['Robert'], labels: ['Sneup workspace', 'Platform', 'Delivery', 'Connector work', 'connector']
    });
  });

  test('Azure DevOps sync executes bounded WIQL reads and selected-field work-item batches only', async () => {
    jest.dontMock('../src/services/azureDevOpsWorkSignalClient');
    jest.resetModules();
    const { AzureDevOpsWorkSignalClient } = require('../src/services/azureDevOpsWorkSignalClient');
    const http = {
      get: jest.fn().mockResolvedValue({ data: { value: [{ id: 'project-1', name: 'Sneup' }] } }),
      post: jest.fn()
        .mockResolvedValueOnce({ data: { workItems: [{ id: 42 }] } })
        .mockResolvedValueOnce({ data: { value: [{
          id: 42,
          fields: {
            'System.Title': 'Ship Azure DevOps sync', 'System.WorkItemType': 'Task', 'System.State': 'Active',
            'System.AssignedTo': { displayName: 'Robert' }, 'System.Tags': 'connector; platform',
            'System.CreatedDate': '2026-07-09T09:00:00.000Z', 'System.ChangedDate': '2026-07-09T12:00:00.000Z',
            'Microsoft.VSTS.Common.Priority': 2, 'System.TeamProject': 'Sneup', 'System.AreaPath': 'Sneup\\Platform', 'System.IterationPath': 'Sneup\\Sprint 1'
          },
          relations: [{ rel: 'System.LinkTypes.Dependency-Reverse', url: 'https://dev.azure.com/no/_apis/wit/workItems/41' }]
        }] } })
    };
    const client = new AzureDevOpsWorkSignalClient({
      http,
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'azure-pat' })) }
    });

    const result = await client.fetchDelta({ connectorId: 'azure_devops', metadata: { fields: { organizationUrl: 'https://dev.azure.com/noodzakelijk' } } }, '2026-07-09T10:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith(
      'https://dev.azure.com/noodzakelijk/_apis/projects',
      expect.objectContaining({ params: expect.objectContaining({ 'api-version': '7.1', '$top': 25 }) })
    );
    expect(http.post.mock.calls[0][0]).toBe('https://dev.azure.com/noodzakelijk/Sneup/_apis/wit/wiql');
    expect(http.post.mock.calls[0][1].query).toContain('SELECT [System.Id] FROM WorkItems');
    expect(http.post.mock.calls[1][0]).toBe('https://dev.azure.com/noodzakelijk/Sneup/_apis/wit/workitemsbatch');
    expect(http.post.mock.calls[1][1]).toMatchObject({ ids: [42], '$expand': 'Relations', errorPolicy: 'Omit' });
    expect(http.post.mock.calls[1][1].fields).not.toContain('System.Description');
    const requestPaths = http.post.mock.calls.map(call => call[0]).join(' ');
    expect(requestPaths).not.toMatch(/create|delete|comment/i);
    expect(result).toMatchObject({ metadata: { source: 'azure_devops_api', projects: 1, items: 1 }, hasMore: false });
    expect(result.records[0]).toMatchObject({ id: '42', dependencies: ['41'] });
  });

  test('Azure DevOps normalization preserves work-item metadata and provider-native dependencies without descriptions', () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const normalized = workSignalAdapterService.normalize({ connectorId: 'azure_devops' }, {
      id: '42', title: 'Ship Azure DevOps sync', workItemType: 'Task', status: 'Active', priority: 2,
      assignee: { displayName: 'Robert' }, tags: ['connector'], project: { name: 'Sneup' }, areaPath: 'Sneup\\Platform', iterationPath: 'Sneup\\Sprint 1',
      dependencies: ['41'], changedDate: '2026-07-09T12:00:00.000Z', url: 'https://dev.azure.com/noodzakelijk/Sneup/_workitems/edit/42'
    });

    expect(normalized).toMatchObject({
      externalId: '42', sourceType: 'task', title: 'Ship Azure DevOps sync', description: '', status: 'in_progress', priority: 'high', owners: ['Robert'], labels: ['Sneup', 'Task', 'Sneup\\Platform', 'Sneup\\Sprint 1', 'connector']
    });
    expect(normalized.raw.dependencies).toEqual(['41']);
  });

  test('Wrike sync reads bounded project and task metadata without descriptions, comments, or provider writes', async () => {
    jest.dontMock('../src/services/wrikeWorkSignalClient');
    jest.resetModules();
    const { WrikeWorkSignalClient } = require('../src/services/wrikeWorkSignalClient');
    const http = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: { data: [{
          id: 'project-1', title: 'Sneup delivery', createdDate: '2026-07-09T09:00:00.000Z', updatedDate: '2026-07-09T12:00:00.000Z'
        }] } })
        .mockResolvedValueOnce({ data: { data: [{
          id: 'task-1', title: 'Ship Wrike sync', status: 'Active', importance: 'High', createdDate: '2026-07-09T09:00:00.000Z', updatedDate: '2026-07-09T12:00:00.000Z',
          dates: { due: '2026-07-15T00:00:00.000Z' }, responsibleIds: ['user-1'], parentIds: ['project-1'], dependencyIds: ['dependency-1'],
          description: 'Private project detail', customFields: [{ value: 'Private field' }], permalink: 'https://www.wrike.com/open.htm?id=task-1'
        }] } })
    };
    const client = new WrikeWorkSignalClient({
      http,
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'wrike-token' })) }
    });

    const result = await client.fetchDelta({ connectorId: 'wrike' }, '2026-07-09T10:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith(
      'https://www.wrike.com/api/v4/folders',
      expect.objectContaining({ params: expect.objectContaining({ project: true }), headers: expect.objectContaining({ Authorization: 'Bearer wrike-token' }) })
    );
    expect(http.get).toHaveBeenCalledWith(
      'https://www.wrike.com/api/v4/tasks',
      expect.objectContaining({ params: expect.objectContaining({ sortField: 'UpdatedDate', sortOrder: 'Desc', updatedDate: expect.any(String) }) })
    );
    const requested = http.get.mock.calls.map(call => `${call[0]} ${JSON.stringify(call[1]?.params || {})}`).join(' ');
    expect(requested).not.toMatch(/comment|description|customfields|attachment/i);
    expect(http).not.toHaveProperty('post');
    expect(result.records[0]).not.toHaveProperty('description');
    expect(result.records[0]).not.toHaveProperty('customFields');
    expect(result).toMatchObject({ metadata: { source: 'wrike_api', projects: 1, items: 1 }, hasMore: false, nextCursor: '2026-07-09T12:00:00.000Z' });
    expect(result.records[0]).toMatchObject({ projectNames: ['Sneup delivery'], responsibleIds: ['user-1'] });
  });

  test('Wrike normalization preserves project context and schedules without task descriptions', () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const normalized = workSignalAdapterService.normalize({ connectorId: 'wrike' }, {
      id: 'task-1', title: 'Ship Wrike sync', status: 'Active', importance: 'High', responsibleIds: ['user-1'], projectNames: ['Sneup delivery'],
      dates: { due: '2026-07-15T00:00:00.000Z' }, createdDate: '2026-07-09T09:00:00.000Z', updatedDate: '2026-07-09T12:00:00.000Z'
    });

    expect(normalized).toMatchObject({
      externalId: 'task-1', sourceType: 'task', title: 'Ship Wrike sync', description: '', status: 'open', priority: 'high', owners: ['user-1'], labels: ['Sneup delivery', 'Active']
    });
  });

  test('Smartsheet sync reads bounded selected row fields without attachments, discussions, or arbitrary cell data', async () => {
    jest.dontMock('../src/services/smartsheetWorkSignalClient');
    jest.resetModules();
    const { SmartsheetWorkSignalClient } = require('../src/services/smartsheetWorkSignalClient');
    const http = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: { data: [{ id: 1001, name: 'Launch plan', owner: 'Robert', ownerId: 3, permalink: 'https://app.smartsheet.com/sheets/launch' }], totalPages: 1, totalCount: 1 } })
        .mockResolvedValueOnce({ data: { data: [
          { id: 10, title: 'Task name', primary: true },
          { id: 11, title: 'Status' },
          { id: 12, title: 'Priority' },
          { id: 13, title: 'Assigned to' },
          { id: 14, title: 'Due date' },
          { id: 15, title: 'Private notes' }
        ] } })
        .mockResolvedValueOnce({ data: { rows: [{
          id: 501, createdAt: '2026-07-09T09:00:00.000Z', modifiedAt: '2026-07-09T12:00:00.000Z',
          cells: [
            { columnId: 10, value: 'Ship Smartsheet sync' }, { columnId: 11, value: 'In Progress' }, { columnId: 12, value: 'High' },
            { columnId: 13, displayValue: 'Robert; Nina' }, { columnId: 14, value: '2026-07-15' }, { columnId: 15, value: 'Do not ingest this detail' }
          ]
        }], totalPages: 1, totalCount: 1 } })
    };
    const client = new SmartsheetWorkSignalClient({
      http,
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'smartsheet-token' })) }
    });

    const result = await client.fetchDelta({ connectorId: 'smartsheet' }, '2026-07-09T10:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith(
      'https://api.smartsheet.com/2.0/sheets',
      expect.objectContaining({ params: expect.objectContaining({ page: 1, pageSize: 25 }), headers: expect.objectContaining({ Authorization: 'Bearer smartsheet-token' }) })
    );
    expect(http.get).toHaveBeenCalledWith(
      'https://api.smartsheet.com/2.0/sheets/1001/columns',
      expect.objectContaining({ params: expect.objectContaining({ page: 1, pageSize: 100 }) })
    );
    expect(http.get).toHaveBeenCalledWith(
      'https://api.smartsheet.com/2.0/sheets/1001',
      expect.objectContaining({ params: expect.objectContaining({ rowsModifiedSince: expect.any(String), columnIds: '10,11,12,13,14' }) })
    );
    const requested = http.get.mock.calls.map(call => `${call[0]} ${JSON.stringify(call[1]?.params || {})}`).join(' ');
    expect(requested).not.toMatch(/attachment|discussion|objectvalue|rowpermalink|notes/i);
    expect(http).not.toHaveProperty('post');
    expect(result).toMatchObject({ metadata: { source: 'smartsheet_api', projects: 1, items: 1 }, hasMore: false, nextCursor: '2026-07-09T12:00:00.000Z' });
    expect(result.records[0]).toMatchObject({ title: 'Ship Smartsheet sync', owners: ['Robert', 'Nina'], sheet: { id: '1001', name: 'Launch plan' } });
    expect(JSON.stringify(result.records[0])).not.toContain('Do not ingest this detail');
  });

  test('Smartsheet normalization preserves selected task context without row descriptions', () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const normalized = workSignalAdapterService.normalize({ connectorId: 'smartsheet' }, {
      externalId: 'sheet:1001:row:501', title: 'Ship Smartsheet sync', status: 'In Progress', priority: 'High', owners: ['Robert'], dueAt: '2026-07-15',
      createdAt: '2026-07-09T09:00:00.000Z', modifiedAt: '2026-07-09T12:00:00.000Z', sheet: { id: '1001', name: 'Launch plan', permalink: 'https://app.smartsheet.com/sheets/launch' }
    });

    expect(normalized).toMatchObject({
      externalId: 'sheet:1001:row:501', sourceType: 'task', title: 'Ship Smartsheet sync', description: '', status: 'in_progress', priority: 'high', owners: ['Robert'], labels: ['Launch plan', 'In Progress']
    });
    expect(normalized.raw.sheet).toMatchObject({ id: '1001', name: 'Launch plan' });
  });

  test('Airtable sync only requests explicit fields with bounded read-only record pages', async () => {
    jest.dontMock('../src/services/airtableWorkSignalClient');
    jest.resetModules();
    const { AirtableWorkSignalClient } = require('../src/services/airtableWorkSignalClient');
    const http = { get: jest.fn().mockResolvedValue({ data: { records: [{ id: 'rec-1', createdTime: '2026-07-10T08:00:00.000Z', fields: { Task: 'Ship Airtable sync', Status: 'In Progress', Priority: 'High', Owner: 'Robert', Due: '2026-07-15', PrivateNotes: 'Never retain this' } }] } }) };
    const client = new AirtableWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'airtable-token' })) } });
    const result = await client.fetchDelta({ metadata: { fields: { baseId: 'app123', tableName: 'Tasks', fieldNames: 'Task, Status, Priority, Owner, Due' } } });
    expect(http.get).toHaveBeenCalledWith('https://api.airtable.com/v0/app123/Tasks', expect.objectContaining({ params: expect.objectContaining({ 'fields[]': ['Task', 'Status', 'Priority', 'Owner', 'Due'], pageSize: 100 }), headers: expect.objectContaining({ Authorization: 'Bearer airtable-token' }) }));
    expect(http).not.toHaveProperty('post');
    expect(JSON.stringify(result.records[0])).not.toContain('Never retain this');
    expect(result).toMatchObject({ metadata: { source: 'airtable_api', projects: 1, items: 1 }, hasMore: false });
  });

  test('Todoist sync uses only bounded project and task GET requests without descriptions', async () => {
    jest.dontMock('../src/services/todoistWorkSignalClient');
    jest.resetModules();
    const { TodoistWorkSignalClient } = require('../src/services/todoistWorkSignalClient');
    const http = { get: jest.fn().mockResolvedValueOnce({ data: [{ id: 'p-1', name: 'Sneup' }] }).mockResolvedValueOnce({ data: [{ id: 't-1', content: 'Ship Todoist sync', description: 'Private detail', project_id: 'p-1', priority: 3, due: { date: '2026-07-15' }, created_at: '2026-07-10T08:00:00.000Z' }] }) };
    const client = new TodoistWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'todoist-token' })) } });
    const result = await client.fetchDelta({});
    expect(http.get).toHaveBeenCalledWith('https://api.todoist.com/rest/v2/projects', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer todoist-token' }) }));
    expect(http.get).toHaveBeenCalledWith('https://api.todoist.com/rest/v2/tasks', expect.any(Object));
    expect(http).not.toHaveProperty('post');
    expect(JSON.stringify(result.records[0])).not.toContain('Private detail');
  });

  test('Shortcut sync reads bounded project story metadata with no descriptions, comments, files, labels, custom fields, or provider writes', async () => {
    jest.dontMock('../src/services/shortcutWorkSignalClient');
    jest.resetModules();
    const { ShortcutWorkSignalClient } = require('../src/services/shortcutWorkSignalClient');
    const http = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: [{ id: 10, name: 'Sneup delivery', app_url: 'https://app.shortcut.com/noodzakelijk/projects/10' }] })
        .mockResolvedValueOnce({ data: [{
          id: 42, name: 'Ship Shortcut sync', completed: false, blocked: true, started: true, story_type: 'feature', owner_ids: ['member-1'],
          deadline: '2026-07-15T00:00:00.000Z', created_at: '2026-07-09T09:00:00.000Z', updated_at: '2026-07-09T12:00:00.000Z',
          app_url: 'https://app.shortcut.com/noodzakelijk/story/42/ship-shortcut-sync', description: 'Private detail', comments: [{ text: 'Do not ingest' }],
          files: [{ name: 'private.pdf' }], labels: [{ name: 'private-label' }], custom_fields: [{ value: 'private-field' }],
          story_links: [{ subject_id: 41, object_id: 42, verb: 'blocks' }, { subject_id: 42, object_id: 43, verb: 'blocks' }, { subject_id: 42, object_id: 44, verb: 'relates to' }]
        }] })
    };
    const client = new ShortcutWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'shortcut-token' })) } });
    const result = await client.fetchDelta({ connectorId: 'shortcut' }, '2026-07-09T10:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith('https://api.app.shortcut.com/api/v3/projects', expect.objectContaining({ headers: expect.objectContaining({ 'Shortcut-Token': 'shortcut-token' }) }));
    expect(http.get).toHaveBeenCalledWith('https://api.app.shortcut.com/api/v3/projects/10/stories', expect.any(Object));
    expect(http).not.toHaveProperty('post');
    const requested = http.get.mock.calls.map(call => call[0]).join(' ');
    expect(requested).not.toMatch(/comment|description|file|label|custom/i);
    expect(JSON.stringify(result.records[0])).not.toContain('Private detail');
    expect(JSON.stringify(result.records[0])).not.toContain('Do not ingest');
    expect(JSON.stringify(result.records[0])).not.toContain('private.pdf');
    expect(JSON.stringify(result.records[0])).not.toContain('private-label');
    expect(JSON.stringify(result.records[0])).not.toContain('private-field');
    expect(result).toMatchObject({ metadata: { source: 'shortcut_api', projects: 1, items: 1 }, hasMore: false, nextCursor: '2026-07-09T12:00:00.000Z' });
    expect(result.records[0]).toMatchObject({ dependencies: ['41'], dependents: ['43'], related: ['44'], project: { id: '10', name: 'Sneup delivery' } });
  });

  test('Shortcut sync fails closed at the configured project cap before requesting stories', async () => {
    jest.dontMock('../src/services/shortcutWorkSignalClient');
    jest.resetModules();
    const { ShortcutWorkSignalClient } = require('../src/services/shortcutWorkSignalClient');
    const previousLimit = process.env.SNEUP_SHORTCUT_MAX_PROJECTS;
    process.env.SNEUP_SHORTCUT_MAX_PROJECTS = '1';
    const http = { get: jest.fn().mockResolvedValue({ data: [{ id: 10, name: 'One' }, { id: 11, name: 'Two' }] }) };
    const client = new ShortcutWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'shortcut-token' })) } });
    try {
      await expect(client.fetchDelta({ connectorId: 'shortcut' })).rejects.toMatchObject({ statusCode: 413 });
      expect(http.get).toHaveBeenCalledTimes(1);
      expect(http.get.mock.calls[0][0]).toBe('https://api.app.shortcut.com/api/v3/projects');
    } finally {
      if (previousLimit === undefined) delete process.env.SNEUP_SHORTCUT_MAX_PROJECTS;
      else process.env.SNEUP_SHORTCUT_MAX_PROJECTS = previousLimit;
    }
  });

  test('Shortcut normalization preserves bounded story scheduling and dependency context without private content', () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const normalized = workSignalAdapterService.normalize({ connectorId: 'shortcut' }, {
      id: '42', title: 'Ship Shortcut sync', completed: false, blocked: true, started: true, storyType: 'feature', ownerIds: ['member-1'],
      dueAt: '2026-07-15T00:00:00.000Z', createdAt: '2026-07-09T09:00:00.000Z', updatedAt: '2026-07-09T12:00:00.000Z',
      url: 'https://app.shortcut.com/noodzakelijk/story/42/ship-shortcut-sync', project: { id: '10', name: 'Sneup delivery' }, dependencies: ['41'], dependents: ['43']
    });

    expect(normalized).toMatchObject({
      externalId: '42', sourceType: 'issue', title: 'Ship Shortcut sync', description: '', status: 'blocked', priority: 'critical', owners: ['member-1'], labels: ['Sneup delivery', 'feature']
    });
    expect(normalized.raw).toMatchObject({ dependencies: ['41'], dependents: ['43'] });
  });

  test('Bitbucket sync reads bounded repository issue and pull-request metadata without descriptions, comments, diffs, or provider writes', async () => {
    jest.dontMock('../src/services/bitbucketWorkSignalClient');
    jest.resetModules();
    const { BitbucketWorkSignalClient } = require('../src/services/bitbucketWorkSignalClient');
    const http = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: { values: [{ uuid: '{repo-1}', full_name: 'noodzakelijk/sneup', name: 'Sneup', slug: 'sneup', updated_on: '2026-07-10T08:00:00.000Z', links: { html: { href: 'https://bitbucket.org/noodzakelijk/sneup' } } }] } })
        .mockResolvedValueOnce({ data: { values: [{ id: 7, title: 'Ship Bitbucket sync', state: 'open', priority: 'major', kind: 'bug', assignee: { display_name: 'Robert' }, created_on: '2026-07-09T09:00:00.000Z', updated_on: '2026-07-10T10:00:00.000Z', content: { raw: 'Private issue detail' }, links: { html: { href: 'https://bitbucket.org/noodzakelijk/sneup/issues/7' } } }] } })
        .mockResolvedValueOnce({ data: { values: [{ id: 8, title: 'Review provider sync', state: 'OPEN', author: { display_name: 'Nina' }, reviewers: [{ display_name: 'Robert' }], created_on: '2026-07-09T10:00:00.000Z', updated_on: '2026-07-10T11:00:00.000Z', description: 'Private PR detail', links: { html: { href: 'https://bitbucket.org/noodzakelijk/sneup/pull-requests/8' } } }] } })
    };
    const client = new BitbucketWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'bitbucket-token' })) } });
    const account = { connectorId: 'bitbucket', metadata: { fields: { workspace: 'noodzakelijk' } } };
    const result = await client.fetchDelta(account, '2026-07-10T09:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith('https://api.bitbucket.org/2.0/repositories/noodzakelijk', expect.objectContaining({ params: expect.objectContaining({ page: 1, pagelen: 20 }), headers: expect.objectContaining({ Authorization: 'Bearer bitbucket-token' }) }));
    expect(http.get).toHaveBeenCalledWith('https://api.bitbucket.org/2.0/repositories/noodzakelijk/sneup/issues', expect.objectContaining({ params: expect.objectContaining({ page: 1, pagelen: 100 }) }));
    expect(http.get).toHaveBeenCalledWith('https://api.bitbucket.org/2.0/repositories/noodzakelijk/sneup/pullrequests', expect.objectContaining({ params: expect.objectContaining({ state: 'OPEN', page: 1, pagelen: 100 }) }));
    expect(http).not.toHaveProperty('post');
    const requested = http.get.mock.calls.map(call => `${call[0]} ${JSON.stringify(call[1]?.params || {})}`).join(' ');
    expect(requested).not.toMatch(/comment|diff|deployment|description|content/i);
    expect(JSON.stringify(result.records)).not.toContain('Private issue detail');
    expect(JSON.stringify(result.records)).not.toContain('Private PR detail');
    expect(result).toMatchObject({ metadata: { source: 'bitbucket_api', repositories: 1, items: 2 }, hasMore: false, nextCursor: '2026-07-10T11:00:00.000Z' });
    expect(result.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'issue:7', owners: ['Robert'], repository: expect.objectContaining({ fullName: 'noodzakelijk/sneup' }) }),
      expect.objectContaining({ id: 'pull_request:8', owners: ['Nina', 'Robert'] })
    ]));
  });

  test('Bitbucket sync fails closed at its configured repository cap before reading issues or pull requests', async () => {
    jest.dontMock('../src/services/bitbucketWorkSignalClient');
    jest.resetModules();
    const { BitbucketWorkSignalClient } = require('../src/services/bitbucketWorkSignalClient');
    const previousLimit = process.env.SNEUP_BITBUCKET_MAX_REPOSITORIES;
    process.env.SNEUP_BITBUCKET_MAX_REPOSITORIES = '1';
    const http = { get: jest.fn().mockResolvedValue({ data: { values: [{ full_name: 'noodzakelijk/one', slug: 'one' }], next: 'https://api.bitbucket.org/2.0/repositories/noodzakelijk?page=2' } }) };
    const client = new BitbucketWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'bitbucket-token' })) } });
    try {
      await expect(client.fetchDelta({ metadata: { fields: { workspace: 'noodzakelijk' } } })).rejects.toMatchObject({ statusCode: 413 });
      expect(http.get).toHaveBeenCalledTimes(1);
      expect(http.get.mock.calls[0][0]).toBe('https://api.bitbucket.org/2.0/repositories/noodzakelijk');
    } finally {
      if (previousLimit === undefined) delete process.env.SNEUP_BITBUCKET_MAX_REPOSITORIES;
      else process.env.SNEUP_BITBUCKET_MAX_REPOSITORIES = previousLimit;
    }
  });

  test('Bitbucket normalization preserves issue and pull-request context without content fields', () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const normalized = workSignalAdapterService.normalize({ connectorId: 'bitbucket' }, {
      id: 'issue:7', sourceType: 'issue', title: 'Ship Bitbucket sync', status: 'open', priority: 'major', kind: 'bug', owners: ['Robert'],
      createdAt: '2026-07-09T09:00:00.000Z', updatedAt: '2026-07-10T10:00:00.000Z', url: 'https://bitbucket.org/noodzakelijk/sneup/issues/7', repository: { fullName: 'noodzakelijk/sneup' }
    });
    expect(normalized).toMatchObject({
      externalId: 'issue:7', sourceType: 'issue', title: 'Ship Bitbucket sync', description: '', status: 'open', priority: 'high', owners: ['Robert'], labels: ['noodzakelijk/sneup', 'bug', 'issue']
    });
  });

  test('Harvest sync reads bounded time-entry metadata without notes, rates, invoices, or provider writes', async () => {
    jest.dontMock('../src/services/harvestWorkSignalClient');
    jest.resetModules();
    const { HarvestWorkSignalClient } = require('../src/services/harvestWorkSignalClient');
    const http = { get: jest.fn().mockResolvedValue({ data: {
      time_entries: [{
        id: 71, spent_date: '2026-07-10', hours: 2.25, rounded_hours: 2.5, approval_status: 'approved', is_running: false, billable: true,
        created_at: '2026-07-10T09:00:00.000Z', updated_at: '2026-07-10T12:00:00.000Z',
        user: { id: 9, name: 'Robert' }, client: { id: 5, name: 'Noodzakelijk' }, project: { id: 3, name: 'Sneup' }, task: { id: 4, name: 'Connector delivery' },
        notes: 'Private meeting notes', billable_rate: 125, cost_rate: 80, invoice: { id: 1, number: 'INV-001' }
      }], total_entries: 1, next_page: null
    } }) };
    const client = new HarvestWorkSignalClient({
      http,
      now: () => new Date('2026-07-14T12:00:00.000Z'),
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'harvest-token' })) }
    });
    const account = { connectorId: 'harvest', metadata: { fields: { accountId: '123456' } } };
    const result = await client.fetchDelta(account, '2026-07-10T10:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith('https://api.harvestapp.com/v2/time_entries', expect.objectContaining({
      params: expect.objectContaining({ page: 1, per_page: 250, from: '2026-04-15', to: '2026-07-14', updated_since: expect.any(String) }),
      headers: expect.objectContaining({ Authorization: 'Bearer harvest-token', 'Harvest-Account-Id': '123456', 'User-Agent': expect.stringContaining('Sneup') })
    }));
    expect(http).not.toHaveProperty('post');
    expect(JSON.stringify(result.records)).not.toContain('Private meeting notes');
    expect(JSON.stringify(result.records)).not.toContain('INV-001');
    expect(JSON.stringify(result.records)).not.toContain('125');
    expect(result).toMatchObject({ metadata: { source: 'harvest_api', projects: 1, items: 1 }, hasMore: false, nextCursor: '2026-07-10T12:00:00.000Z' });
    expect(result.records[0]).toMatchObject({ id: 'time_entry:71', hours: 2.5, user: { name: 'Robert' }, project: { name: 'Sneup' } });
  });

  test('Harvest sync fails closed when the configured time-entry limit would truncate provider data', async () => {
    jest.dontMock('../src/services/harvestWorkSignalClient');
    jest.resetModules();
    const { HarvestWorkSignalClient } = require('../src/services/harvestWorkSignalClient');
    const previousLimit = process.env.SNEUP_HARVEST_MAX_ENTRIES;
    process.env.SNEUP_HARVEST_MAX_ENTRIES = '1';
    const http = { get: jest.fn().mockResolvedValue({ data: { time_entries: [{ id: 1 }, { id: 2 }], total_entries: 2, next_page: 2 } }) };
    const client = new HarvestWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'harvest-token' })) } });
    try {
      await expect(client.fetchDelta({ metadata: { fields: { accountId: '123456' } } })).rejects.toMatchObject({ statusCode: 413 });
      expect(http.get).toHaveBeenCalledTimes(1);
    } finally {
      if (previousLimit === undefined) delete process.env.SNEUP_HARVEST_MAX_ENTRIES;
      else process.env.SNEUP_HARVEST_MAX_ENTRIES = previousLimit;
    }
  });

  test('Harvest normalization preserves utilization context without private time-entry content', () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const normalized = workSignalAdapterService.normalize({ connectorId: 'harvest' }, {
      id: 'time_entry:71', spentDate: '2026-07-10', hours: 2.5, approvalStatus: 'approved', isRunning: false, billable: true,
      createdAt: '2026-07-10T09:00:00.000Z', updatedAt: '2026-07-10T12:00:00.000Z',
      user: { id: 9, name: 'Robert' }, client: { id: 5, name: 'Noodzakelijk' }, project: { id: 3, name: 'Sneup' }, task: { id: 4, name: 'Connector delivery' }, notes: 'Private detail'
    });
    expect(normalized).toMatchObject({
      externalId: 'time_entry:71', sourceType: 'time_entry', title: 'Sneup - Connector delivery', description: '', status: 'done', priority: 'normal', owners: ['Robert'], labels: ['Noodzakelijk', 'Sneup', 'Connector delivery', 'billable', 'approved']
    });
    expect(JSON.stringify(normalized.raw)).not.toContain('Private detail');
  });

  test('Coda sync reads bounded table metadata from explicitly allowed documents without fetching rows or document content', async () => {
    jest.dontMock('../src/services/codaWorkSignalClient');
    jest.resetModules();
    const { CodaWorkSignalClient } = require('../src/services/codaWorkSignalClient');
    const http = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: { items: [{
          id: 'grid-1', name: 'Release tracker', tableType: 'table', rowCount: 12,
          browserLink: 'https://coda.io/d/Sneup_dDoc-A/#Release-tracker_tu1',
          parent: { name: 'Sensitive delivery page' }, values: { status: 'Private row value' },
          createdAt: '2026-07-10T09:00:00.000Z', updatedAt: '2026-07-10T12:00:00.000Z'
        }], nextPageToken: 'more-tables' } })
        .mockResolvedValueOnce({ data: { items: [{
          id: 'grid-2', name: 'Risk register', tableType: 'view', rowCount: 3,
          browserLink: 'https://coda.io/d/Sneup_dDoc-A/#Risks_tu2',
          createdAt: '2026-07-11T09:00:00.000Z', updatedAt: '2026-07-11T10:00:00.000Z'
        }] } })
    };
    const client = new CodaWorkSignalClient({
      http,
      now: () => new Date('2026-07-14T12:00:00.000Z'),
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'coda-token' })) }
    });
    const account = { connectorId: 'coda', metadata: { fields: { documentIds: 'Doc-A' } } };
    const result = await client.fetchDelta(account, '2026-07-09T10:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith('https://coda.io/apis/v1/docs/Doc-A/tables', expect.objectContaining({
      params: { limit: 100 }, headers: expect.objectContaining({ Authorization: 'Bearer coda-token' })
    }));
    expect(http.get).toHaveBeenCalledWith('https://coda.io/apis/v1/docs/Doc-A/tables', expect.objectContaining({
      params: { limit: 99, pageToken: 'more-tables' }
    }));
    expect(http).not.toHaveProperty('post');
    const requested = http.get.mock.calls.map(call => `${call[0]} ${JSON.stringify(call[1]?.params || {})}`).join(' ');
    expect(requested).not.toMatch(/rows|columns|pages|buttons/i);
    expect(JSON.stringify(result.records)).not.toContain('Private row value');
    expect(JSON.stringify(result.records)).not.toContain('Sensitive delivery page');
    expect(result).toMatchObject({ metadata: { source: 'coda_api', documents: 1, tables: 2, contentPolicy: 'allowlisted_document_table_metadata_only' }, hasMore: false, nextCursor: '2026-07-11T10:00:00.000Z' });
    expect(result.records[0]).toMatchObject({ id: 'table:Doc-A:grid-1', documentId: 'Doc-A', tableId: 'grid-1', name: 'Release tracker', rowCount: 12 });
  });

  test('Coda sync fails closed without an explicit document allowlist or when a table cap would truncate metadata', async () => {
    jest.dontMock('../src/services/codaWorkSignalClient');
    jest.resetModules();
    const { CodaWorkSignalClient } = require('../src/services/codaWorkSignalClient');
    const noDocumentHttp = { get: jest.fn() };
    const noDocumentClient = new CodaWorkSignalClient({ http: noDocumentHttp, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'coda-token' })) } });
    await expect(noDocumentClient.fetchDelta({ metadata: { fields: {} } })).rejects.toMatchObject({ statusCode: 400 });
    expect(noDocumentHttp.get).not.toHaveBeenCalled();

    const previousLimit = process.env.SNEUP_CODA_MAX_TABLES_PER_DOCUMENT;
    process.env.SNEUP_CODA_MAX_TABLES_PER_DOCUMENT = '1';
    const cappedHttp = { get: jest.fn().mockResolvedValue({ data: { items: [{ id: 'grid-1', name: 'One table' }], nextPageToken: 'more' } }) };
    const cappedClient = new CodaWorkSignalClient({ http: cappedHttp, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'coda-token' })) } });
    try {
      await expect(cappedClient.fetchDelta({ metadata: { fields: { documentIds: 'Doc-A' } } })).rejects.toMatchObject({ statusCode: 413 });
      expect(cappedHttp.get).toHaveBeenCalledTimes(1);
    } finally {
      if (previousLimit === undefined) delete process.env.SNEUP_CODA_MAX_TABLES_PER_DOCUMENT;
      else process.env.SNEUP_CODA_MAX_TABLES_PER_DOCUMENT = previousLimit;
    }
  });

  test('Coda adapter registers credential-backed document metadata normalization without retaining arbitrary content', () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(workSignalAdapterService.getAdapter('coda').capabilities.credentialBackedSync).toBe(true);
    const normalized = workSignalAdapterService.normalize({ connectorId: 'coda' }, {
      id: 'table:Doc-A:grid-1', documentId: 'Doc-A', tableId: 'grid-1', name: 'Release tracker', tableType: 'table', rowCount: 12,
      browserLink: 'https://coda.io/d/Sneup_dDoc-A/#Release-tracker_tu1', updatedAt: '2026-07-10T12:00:00.000Z', values: { private: 'No row data' }
    });
    expect(normalized).toMatchObject({
      externalId: 'table:Doc-A:grid-1', sourceType: 'document', title: 'Release tracker', description: '', status: 'open', priority: 'normal', labels: ['coda_table', 'Doc-A', 'table']
    });
    expect(JSON.stringify(normalized.raw)).not.toContain('No row data');
  });

  test('Teamwork sync reads bounded project and task metadata without rich content, private tasks, or provider writes', async () => {
    jest.dontMock('../src/services/teamworkWorkSignalClient');
    jest.resetModules();
    const { TeamworkWorkSignalClient } = require('../src/services/teamworkWorkSignalClient');
    const http = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: { projects: [{
          id: 9, name: 'Sneup release', status: 'current', updatedAt: '2026-07-11T10:00:00.000Z',
          company: { name: 'Private client' }, description: 'Private project description', budgets: { amount: 5000 }
        }] } })
        .mockResolvedValueOnce({ data: { tasks: [{
          id: 18, name: 'Ship Teamwork connector', status: 'in progress', priority: 'high', tasklistId: 4, projectId: 9,
          startDate: '2026-07-10', dueDate: '2026-07-15', dateUpdated: '2026-07-12T12:00:00.000Z',
          description: 'Private task description', comments: [{ body: 'Private comment' }], files: [{ name: 'secret.pdf' }]
        }, {
          id: 19, name: 'Private client task', isPrivate: true, description: 'Must not enter Sneup'
        }] } })
    };
    const client = new TeamworkWorkSignalClient({
      http,
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'teamwork-key' })) }
    });
    const result = await client.fetchDelta({ connectorId: 'teamwork', metadata: { fields: { siteUrl: 'https://sneup.teamwork.com' } } }, '2026-07-10T10:00:00.000Z');

    const auth = `Basic ${Buffer.from('teamwork-key:password').toString('base64')}`;
    expect(http.get).toHaveBeenCalledWith('https://sneup.teamwork.com/projects/api/v3/projects.json', expect.objectContaining({
      params: expect.objectContaining({ page: 1, pageSize: 100, skipCounts: true, updatedAfter: '2026-07-10T09:59:00.000Z' }),
      headers: expect.objectContaining({ Authorization: auth })
    }));
    expect(http.get).toHaveBeenCalledWith('https://sneup.teamwork.com/projects/api/v3/tasks.json', expect.objectContaining({
      params: expect.objectContaining({ 'fields[tasks]': expect.stringContaining('name') })
    }));
    expect(http).not.toHaveProperty('post');
    const requested = http.get.mock.calls.map(call => `${call[0]} ${JSON.stringify(call[1]?.params || {})}`).join(' ');
    expect(requested).not.toMatch(/comments|files|description|time|company|billing/i);
    expect(JSON.stringify(result.records)).not.toMatch(/Private client|Private project description|Private task description|Private comment|secret\.pdf/);
    expect(result).toMatchObject({ metadata: { source: 'teamwork_api', projects: 1, tasks: 1, contentPolicy: 'project_task_metadata_only_private_tasks_excluded' }, hasMore: false, nextCursor: '2026-07-12T12:00:00.000Z' });
    expect(result.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'project:9', name: 'Sneup release', status: 'current' }),
      expect.objectContaining({ id: 'task:18', name: 'Ship Teamwork connector', projectId: 9, dueAt: '2026-07-15' })
    ]));
  });

  test('Teamwork sync rejects untrusted site URLs and fails closed at a configured task cap', async () => {
    jest.dontMock('../src/services/teamworkWorkSignalClient');
    jest.resetModules();
    const { TeamworkWorkSignalClient } = require('../src/services/teamworkWorkSignalClient');
    const untrustedHttp = { get: jest.fn() };
    const untrustedClient = new TeamworkWorkSignalClient({ http: untrustedHttp, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'teamwork-key' })) } });
    await expect(untrustedClient.fetchDelta({ metadata: { fields: { siteUrl: 'http://127.0.0.1' } } })).rejects.toMatchObject({ statusCode: 400 });
    expect(untrustedHttp.get).not.toHaveBeenCalled();

    const previousLimit = process.env.SNEUP_TEAMWORK_MAX_TASKS;
    process.env.SNEUP_TEAMWORK_MAX_TASKS = '1';
    const cappedHttp = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: { projects: [] } })
        .mockResolvedValueOnce({ data: { tasks: [{ id: 1, name: 'One' }] } })
    };
    const cappedClient = new TeamworkWorkSignalClient({ http: cappedHttp, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'teamwork-key' })) } });
    try {
      await expect(cappedClient.fetchDelta({ metadata: { fields: { siteUrl: 'https://sneup.teamwork.com' } } })).rejects.toMatchObject({ statusCode: 413 });
      expect(cappedHttp.get).toHaveBeenCalledTimes(2);
    } finally {
      if (previousLimit === undefined) delete process.env.SNEUP_TEAMWORK_MAX_TASKS;
      else process.env.SNEUP_TEAMWORK_MAX_TASKS = previousLimit;
    }
  });

  test('Teamwork adapter retains only approved task metadata in normalized work signals', () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(workSignalAdapterService.getAdapter('teamwork').capabilities.credentialBackedSync).toBe(true);
    const normalized = workSignalAdapterService.normalize({ connectorId: 'teamwork' }, {
      id: 'task:18', sourceType: 'task', taskId: 18, projectId: 9, tasklistId: 4, name: 'Ship Teamwork connector',
      status: 'in progress', priority: 'high', dueAt: '2026-07-15', updatedAt: '2026-07-12T12:00:00.000Z', description: 'Private detail', comments: ['Private comment']
    });
    expect(normalized).toMatchObject({
      externalId: 'task:18', sourceType: 'task', title: 'Ship Teamwork connector', description: '', status: 'in_progress', priority: 'high', labels: ['teamwork', 'task', 'project:9', 'tasklist:4', 'in progress']
    });
    expect(JSON.stringify(normalized.raw)).not.toMatch(/Private detail|Private comment/);
  });

  test('Basecamp sync reads bounded project and to-do metadata without rich content or provider writes', async () => {
    jest.dontMock('../src/services/basecampWorkSignalClient');
    jest.resetModules();
    const { BasecampWorkSignalClient } = require('../src/services/basecampWorkSignalClient');
    const http = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: [{
          id: 9, name: 'Sneup release', status: 'active', updated_at: '2026-07-11T10:00:00.000Z',
          description: 'Private project description', dock: [{ name: 'todoset', id: 4, enabled: true }]
        }], headers: {} })
        .mockResolvedValueOnce({ data: [{ id: 7, name: 'Launch tasks', description: 'Private list detail' }], headers: {} })
        .mockResolvedValueOnce({ data: [{
          id: 18, content: 'Ship Basecamp connector', due_on: '2026-07-15', updated_at: '2026-07-12T12:00:00.000Z',
          description: 'Private task description', comments: [{ content: 'Private comment' }], attachments: [{ name: 'secret.pdf' }]
        }], headers: {} })
    };
    const client = new BasecampWorkSignalClient({
      http,
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ accessToken: 'basecamp-token' })) }
    });
    const account = { metadata: { fields: { basecampAccountId: '123', basecampApiUrl: 'https://3.basecampapi.com/123' } } };
    const result = await client.fetchDelta(account, '2026-07-10T10:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith('https://3.basecampapi.com/123/projects.json', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer basecamp-token', 'User-Agent': expect.any(String) })
    }));
    expect(http.get).toHaveBeenCalledWith('https://3.basecampapi.com/123/buckets/9/todosets/4/todolists.json', expect.any(Object));
    expect(http.get).toHaveBeenCalledWith('https://3.basecampapi.com/123/todolists/7/todos.json', expect.any(Object));
    expect(http).not.toHaveProperty('post');
    const requested = http.get.mock.calls.map(call => call[0]).join(' ');
    expect(requested).not.toMatch(/messages|comments|files|attachments|schedules|documents/i);
    expect(JSON.stringify(result.records)).not.toMatch(/Private project|Private list|Private task|Private comment|secret\.pdf/);
    expect(result).toMatchObject({ metadata: { source: 'basecamp_api', projects: 1, todoLists: 1, todos: 1, contentPolicy: 'project_todo_metadata_only_selected_account' }, hasMore: false, nextCursor: '2026-07-12T12:00:00.000Z' });
    expect(result.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'project:9', name: 'Sneup release', status: 'active' }),
      expect.objectContaining({ id: 'todo:18', name: 'Ship Basecamp connector', projectId: 9, dueAt: '2026-07-15' })
    ]));
  });

  test('Basecamp sync rejects a missing selected account and fails closed at a pagination cap', async () => {
    jest.dontMock('../src/services/basecampWorkSignalClient');
    jest.resetModules();
    const { BasecampWorkSignalClient } = require('../src/services/basecampWorkSignalClient');
    const unselectedHttp = { get: jest.fn() };
    const unselectedClient = new BasecampWorkSignalClient({ http: unselectedHttp, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ accessToken: 'basecamp-token' })) } });
    await expect(unselectedClient.fetchDelta({ metadata: { fields: {} } })).rejects.toMatchObject({ statusCode: 409 });
    expect(unselectedHttp.get).not.toHaveBeenCalled();

    const previousLimit = process.env.SNEUP_BASECAMP_MAX_PROJECTS;
    process.env.SNEUP_BASECAMP_MAX_PROJECTS = '1';
    const cappedHttp = { get: jest.fn().mockResolvedValue({
      data: [{ id: 9, name: 'One project' }],
      headers: { link: '<https://3.basecampapi.com/123/projects.json?page=2>; rel="next"' }
    }) };
    const cappedClient = new BasecampWorkSignalClient({ http: cappedHttp, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ accessToken: 'basecamp-token' })) } });
    try {
      await expect(cappedClient.fetchDelta({ metadata: { fields: { basecampAccountId: '123', basecampApiUrl: 'https://3.basecampapi.com/123' } } })).rejects.toMatchObject({ statusCode: 413 });
      expect(cappedHttp.get).toHaveBeenCalledTimes(1);
    } finally {
      if (previousLimit === undefined) delete process.env.SNEUP_BASECAMP_MAX_PROJECTS;
      else process.env.SNEUP_BASECAMP_MAX_PROJECTS = previousLimit;
    }
  });

  test('Basecamp adapter retains only approved project and to-do metadata in normalized work signals', () => {
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(workSignalAdapterService.getAdapter('basecamp').capabilities.credentialBackedSync).toBe(true);
    const normalized = workSignalAdapterService.normalize({ connectorId: 'basecamp' }, {
      id: 'todo:18', sourceType: 'todo', todoId: 18, projectId: 9, todoListId: 7, name: 'Ship Basecamp connector',
      status: 'open', dueAt: '2026-07-15', updatedAt: '2026-07-12T12:00:00.000Z', description: 'Private detail', comments: ['Private comment']
    });
    expect(normalized).toMatchObject({
      externalId: 'todo:18', sourceType: 'todo', title: 'Ship Basecamp connector', description: '', status: 'open', priority: 'normal', labels: ['basecamp', 'todo', 'project:9', 'todo_list:7', 'open']
    });
    expect(JSON.stringify(normalized.raw)).not.toMatch(/Private detail|Private comment/);
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
    jest.dontMock('../src/services/policyRuleService');
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
    jest.doMock('../src/services/policyRuleService', () => ({
      resolveEffectivePolicy: jest.fn().mockResolvedValue({
        riskLevel: 'high',
        requiresApproval: true,
        ownerType: 'robert',
        approvalReason: 'Approval required',
        enabled: true
      })
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
  afterEach(() => {
    jest.dontMock('mongoose');
    jest.dontMock('../src/models/AuditEvent');
    jest.dontMock('../src/models/Intervention');
    jest.dontMock('../src/services/workspaceScopeService');
    jest.dontMock('../src/services/policyRuleService');
    jest.dontMock('../src/services/operationsLedgerService');
    jest.resetModules();
  });

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

  test('workspace rules can only tighten the Trello write baseline', () => {
    const { PolicyRuleService } = require('../src/services/policyRuleService');
    const interventionPolicy = require('../src/services/interventionPolicy');
    const service = new PolicyRuleService();
    const base = interventionPolicy.classifyAction('comment', { severity: 'medium' });

    const relaxed = service.mergePolicy(base, {
      _id: 'rule-1',
      riskLevel: 'low',
      requiresApproval: false,
      ownerType: 'system',
      enabled: true,
      reason: 'Attempted bypass'
    });
    const paused = service.mergePolicy(base, {
      _id: 'rule-2',
      riskLevel: 'high',
      requiresApproval: true,
      ownerType: 'robert',
      enabled: false,
      reason: 'Freeze comment actions'
    });

    expect(relaxed).toMatchObject({
      riskLevel: 'medium',
      requiresApproval: true,
      ownerType: 'team',
      enabled: true
    });
    expect(paused).toMatchObject({
      riskLevel: 'high',
      requiresApproval: true,
      ownerType: 'robert',
      enabled: false
    });
    expect(service.serializePolicy('comment', service.mergePolicy(base, null)).policyRuleId).toBeNull();
  });

  test('an expired emergency pause remains blocked and calls for review', () => {
    const { PolicyRuleService } = require('../src/services/policyRuleService');
    const interventionPolicy = require('../src/services/interventionPolicy');
    const service = new PolicyRuleService();
    const base = interventionPolicy.classifyAction('comment', { severity: 'medium' });
    const policy = service.mergePolicy(base, {
      _id: 'rule-expired-pause',
      enabled: false,
      pauseExpiresAt: '2026-01-01T00:00:00.000Z'
    }, new Date('2026-01-02T00:00:00.000Z'));

    expect(service.serializePolicy('comment', policy)).toMatchObject({
      enabled: false,
      pauseExpiresAt: '2026-01-01T00:00:00.000Z',
      pauseReviewOverdue: true
    });
  });

  test('lists only bounded workspace policy update evidence', async () => {
    jest.resetModules();
    const chain = {
      sort: jest.fn(() => chain),
      limit: jest.fn().mockResolvedValue([])
    };
    jest.doMock('mongoose', () => ({ connection: { readyState: 1 } }));
    jest.doMock('../src/models/AuditEvent', () => ({ find: jest.fn(() => chain) }));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn(value => value)
    }));

    const policyRuleService = require('../src/services/policyRuleService');
    await expect(policyRuleService.listPolicyHistory({ workspaceId: 'workspace-1', limit: 500 })).resolves.toEqual([]);

    const AuditEvent = require('../src/models/AuditEvent');
    expect(AuditEvent.find).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      entityType: 'policy_rule',
      action: 'trello_action_policy_updated'
    });
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(chain.limit).toHaveBeenCalledWith(100);
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
    jest.doMock('../src/services/policyRuleService', () => ({
      resolveEffectivePolicy: jest.fn().mockResolvedValue({
        riskLevel: 'medium',
        requiresApproval: true,
        ownerType: 'team',
        approvalReason: 'Approval required',
        enabled: true
      })
    }));

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

  test('reuses a recent scheduled intervention instead of creating another approval candidate', async () => {
    jest.resetModules();

    const existingIntervention = { _id: 'intervention-existing' };
    const findOneChain = { sort: jest.fn().mockResolvedValue(existingIntervention) };
    const findOne = jest.fn(() => findOneChain);

    jest.doMock('../src/models/Intervention', () => ({ findOne }));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      getDefaultWorkspaceObjectId: jest.fn(() => 'workspace-1'),
      normalizeWorkspaceObjectId: jest.fn((value) => value || 'workspace-1')
    }));

    const interventionEngine = require('../src/services/interventionEngine');
    const result = await interventionEngine.createIntervention({
      workspaceId: 'workspace-1',
      boardId: 'board-1',
      cardId: 'card-1',
      memberId: 'member-1',
      type: 'comment',
      trigger: 'no_activity',
      severity: 'medium',
      action: 'Request activity update'
    });

    expect(result).toBe(existingIntervention);
    expect(findOne).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      boardId: 'board-1',
      cardId: 'card-1',
      memberId: 'member-1',
      type: 'comment',
      trigger: 'no_activity',
      status: { $in: ['pending', 'awaiting_approval', 'executing', 'executed'] },
      createdAt: { $gte: expect.any(Date) }
    }));
    expect(findOneChain.sort).toHaveBeenCalledWith({ createdAt: -1 });
  });
});

describe('approved Trello action execution safety', () => {
  afterEach(() => {
    jest.dontMock('../src/models/Recommendation');
    jest.dontMock('../src/services/operationsLedgerService');
    jest.dontMock('../src/services/workspaceScopeService');
    jest.dontMock('../src/services/policyRuleService');
    jest.resetModules();
  });

  test('rejects a provider write whose persisted recommendation attempts to bypass approval', async () => {
    jest.resetModules();
    jest.dontMock('../src/services/operationsLedgerService');

    const recommendation = {
      _id: 'recommendation-1',
      workspaceId: 'workspace-1',
      actionType: 'comment',
      riskLevel: 'medium',
      requiresApproval: false,
      status: 'approved',
      actionPayload: {
        executable: true,
        draftOnly: false,
        cardTrelloId: 'trello-card-1',
        commentText: 'This must not be sent without approval.'
      }
    };

    jest.doMock('../src/models/Recommendation', () => ({
      findOne: jest.fn().mockResolvedValue(recommendation)
    }));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn(value => value)
    }));
    jest.doMock('../src/services/policyRuleService', () => ({
      resolveEffectivePolicy: jest.fn().mockResolvedValue({
        requiresApproval: true,
        enabled: true
      })
    }));

    const operationsLedgerService = require('../src/services/operationsLedgerService');
    jest.spyOn(operationsLedgerService, 'isDatabaseReady').mockReturnValue(true);

    await expect(operationsLedgerService.executeApprovedRecommendation('recommendation-1', {
      workspaceId: 'workspace-1'
    })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('cannot be bypassed')
    });
  });

  test('blocks an approved provider write after its workspace action type is paused', async () => {
    jest.resetModules();
    jest.dontMock('../src/services/operationsLedgerService');

    jest.doMock('../src/models/Recommendation', () => ({
      findOne: jest.fn().mockResolvedValue({
        _id: 'recommendation-2',
        workspaceId: 'workspace-1',
        actionType: 'move_card',
        riskLevel: 'high',
        requiresApproval: true,
        status: 'approved',
        actionPayload: { executable: true, draftOnly: false }
      })
    }));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn(value => value)
    }));
    jest.doMock('../src/services/policyRuleService', () => ({
      resolveEffectivePolicy: jest.fn().mockResolvedValue({
        requiresApproval: true,
        enabled: false
      })
    }));

    const operationsLedgerService = require('../src/services/operationsLedgerService');
    jest.spyOn(operationsLedgerService, 'isDatabaseReady').mockReturnValue(true);

    await expect(operationsLedgerService.executeApprovedRecommendation('recommendation-2', {
      workspaceId: 'workspace-1'
    })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('paused by workspace safety policy')
    });
  });

  test('uses an atomic approved-to-executing claim so a second executor cannot duplicate a provider write', async () => {
    jest.resetModules();
    jest.dontMock('../src/services/operationsLedgerService');

    const findOneAndUpdate = jest.fn().mockResolvedValue(null);
    const findOne = jest.fn().mockResolvedValue({
      _id: 'recommendation-1',
      status: 'executing'
    });

    jest.doMock('../src/models/Recommendation', () => ({
      findOne,
      findOneAndUpdate
    }));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn(value => value)
    }));

    const operationsLedgerService = require('../src/services/operationsLedgerService');

    await expect(operationsLedgerService.claimApprovedRecommendationExecution({
      _id: 'recommendation-1',
      workspaceId: 'workspace-1'
    }, {
      workspaceId: 'workspace-1'
    })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Recommendation execution is already in progress'
    });

    expect(findOneAndUpdate).toHaveBeenCalledWith({
      _id: 'recommendation-1',
      workspaceId: 'workspace-1',
      status: 'approved'
    }, {
      $set: { status: 'executing' }
    }, {
      new: true
    });
  });
});

describe('Trello action reconciliation safety', () => {
  afterEach(() => {
    jest.dontMock('../src/models/TrelloActionAttempt');
    jest.dontMock('../src/models/AuditEvent');
    jest.dontMock('../src/services/operationsLedgerService');
    jest.dontMock('../src/services/workspaceScopeService');
    jest.resetModules();
  });

  test('records human evidence while reconciling a claimed action without another provider write', async () => {
    jest.resetModules();
    jest.dontMock('../src/services/operationsLedgerService');

    const recommendation = {
      _id: 'recommendation-1',
      workspaceId: 'workspace-1',
      actionType: 'move_card',
      riskLevel: 'high',
      status: 'executing',
      save: jest.fn().mockResolvedValue(undefined)
    };
    const attempt = {
      _id: 'attempt-1',
      workspaceId: 'workspace-1',
      actionType: 'move_card',
      status: 'in_progress',
      recommendationId: recommendation,
      interventionId: null,
      reconciliation: { status: 'not_needed' },
      save: jest.fn().mockResolvedValue(undefined),
      toObject: jest.fn(() => ({ _id: 'attempt-1', status: 'succeeded' }))
    };
    const auditCreate = jest.fn().mockResolvedValue({ _id: 'audit-1' });
    const populate = jest.fn().mockResolvedValue(attempt);

    jest.doMock('../src/models/TrelloActionAttempt', () => ({
      findOne: jest.fn(() => ({ populate }))
    }));
    jest.doMock('../src/models/AuditEvent', () => ({ create: auditCreate }));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn(value => value)
    }));

    const operationsLedgerService = require('../src/services/operationsLedgerService');
    jest.spyOn(operationsLedgerService, 'isDatabaseReady').mockReturnValue(true);

    const result = await operationsLedgerService.reconcileTrelloActionAttempt('attempt-1', {
      workspaceId: 'workspace-1',
      outcome: 'succeeded',
      evidence: 'Verified the move in the Trello card activity log.',
      reason: 'Provider action completed before the ledger finalization fault.',
      reconciledBy: 'owner-1'
    });

    expect(result).toMatchObject({
      followUpScheduled: false,
      interventionUpdated: false,
      auditRecorded: true
    });
    expect(attempt.status).toBe('succeeded');
    expect(attempt.reconciliation).toMatchObject({
      status: 'confirmed_succeeded',
      reconciledBy: 'owner-1',
      evidence: 'Verified the move in the Trello card activity log.'
    });
    expect(recommendation.status).toBe('executed');
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'trello_action_reconciled_succeeded',
      source: 'manual',
      trelloActionAttemptId: 'attempt-1'
    }));
  });

  test('classifies unresolved claimed actions by evidence age without calling Trello', async () => {
    jest.resetModules();
    jest.dontMock('../src/services/operationsLedgerService');

    const now = new Date('2026-07-14T12:00:00.000Z');
    const freshAttempt = {
      _id: 'attempt-fresh',
      actionType: 'comment',
      status: 'in_progress',
      startedAt: new Date('2026-07-14T11:30:00.000Z'),
      recommendationId: { _id: 'recommendation-fresh', status: 'executing' }
    };
    const warningAttempt = {
      _id: 'attempt-warning',
      actionType: 'move_card',
      status: 'in_progress',
      startedAt: new Date('2026-07-14T06:00:00.000Z'),
      recommendationId: { _id: 'recommendation-warning', status: 'executing' }
    };
    const criticalAttempt = {
      _id: 'attempt-critical',
      actionType: 'reassign',
      status: 'in_progress',
      startedAt: new Date('2026-07-13T06:00:00.000Z'),
      recommendationId: { _id: 'recommendation-critical', status: 'executing' }
    };
    const chain = {
      sort: jest.fn(() => chain),
      populate: jest.fn(() => chain),
      limit: jest.fn().mockResolvedValue([freshAttempt, warningAttempt, criticalAttempt])
    };

    jest.doMock('../src/models/TrelloActionAttempt', () => ({ find: jest.fn(() => chain) }));
    jest.doMock('../src/services/workspaceScopeService', () => ({ normalizeWorkspaceObjectId: jest.fn(value => value) }));

    const operationsLedgerService = require('../src/services/operationsLedgerService');
    jest.spyOn(operationsLedgerService, 'isDatabaseReady').mockReturnValue(true);

    const health = await operationsLedgerService.getTrelloActionReconciliationHealth({
      workspaceId: 'workspace-1',
      now,
      warningHours: 4,
      criticalHours: 24
    });

    expect(health.summary).toMatchObject({ unresolved: 3, fresh: 1, warning: 1, critical: 1, requiresOperator: 2 });
    expect(health.items.map(item => item.attemptId)).toEqual(['attempt-critical', 'attempt-warning', 'attempt-fresh']);
    expect(health.items.map(item => item.severity)).toEqual(['critical', 'warning', 'fresh']);
    expect(health.items[0].message).toContain('before any new action');
  });
});

describe('intervention outcome verification', () => {
  afterEach(() => {
    jest.dontMock('mongoose');
    jest.dontMock('../src/models/Recommendation');
    jest.dontMock('../src/models/TrelloActionAttempt');
    jest.dontMock('../src/models/WorkerResponse');
    jest.dontMock('../src/models/OutcomeRecord');
    jest.dontMock('../src/models/AuditEvent');
    jest.dontMock('../src/models/Intervention');
    jest.dontMock('../src/models/Card');
    jest.dontMock('../src/models/List');
    jest.dontMock('../src/models/Approval');
    jest.dontMock('../src/models/DecisionQueueItem');
    jest.dontMock('../src/models/FollowUpPlan');
    jest.dontMock('../src/models/CardFinding');
    jest.dontMock('../src/models/BoardHealthSnapshot');
    jest.dontMock('../src/models/Board');
    jest.dontMock('../src/models/Member');
    jest.dontMock('../src/models/WorkItem');
    jest.dontMock('../src/services/trelloClient');
    jest.dontMock('../src/services/workspaceScopeService');
    jest.dontMock('../src/services/operationsLedgerService');
    jest.resetModules();
  });

  test('confirms a synced label outcome without storing worker response text', async () => {
    jest.resetModules();

    const workspaceId = new mongoose.Types.ObjectId();
    const recommendationId = new mongoose.Types.ObjectId();
    const actionAttemptId = new mongoose.Types.ObjectId();
    const cardId = new mongoose.Types.ObjectId();
    const recommendation = {
      _id: recommendationId,
      workspaceId,
      cardId,
      actionType: 'add_label',
      actionPayload: { labelName: 'BLOCKED' },
      riskLevel: 'medium',
      status: 'executed'
    };
    const attempt = {
      _id: actionAttemptId,
      workspaceId,
      recommendationId,
      status: 'succeeded',
      finishedAt: new Date('2026-07-14T10:00:00.000Z')
    };
    const outcome = {
      _id: new mongoose.Types.ObjectId(),
      status: 'confirmed_improved',
      evaluatedBy: 'owner-1',
      toObject() {
        return {
          _id: this._id,
          status: this.status,
          evaluatedBy: this.evaluatedBy,
          evidence: [{ source: 'card_state', summary: 'Current synced card state was checked against the approved action payload.' }]
        };
      }
    };
    const attemptQuery = { sort: jest.fn().mockResolvedValue(attempt) };
    const cardQuery = {
      select: jest.fn(() => cardQuery),
      lean: jest.fn().mockResolvedValue({
        _id: cardId,
        labels: [{ name: 'blocked' }],
        members: [],
        checklists: []
      })
    };
    const responseQuery = {
      sort: jest.fn(() => responseQuery),
      select: jest.fn(() => responseQuery),
      lean: jest.fn().mockResolvedValue(null)
    };
    const existingOutcomeQuery = { lean: jest.fn().mockResolvedValue(null) };
    const auditCreate = jest.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
    const outcomeUpdate = jest.fn().mockResolvedValue(outcome);

    jest.doMock('mongoose', () => ({ ...mongoose, connection: { readyState: 1 } }));
    jest.doMock('../src/models/Recommendation', () => ({ findOne: jest.fn().mockResolvedValue(recommendation) }));
    jest.doMock('../src/models/TrelloActionAttempt', () => ({ findOne: jest.fn(() => attemptQuery) }));
    jest.doMock('../src/models/Card', () => ({ findOne: jest.fn(() => cardQuery) }));
    jest.doMock('../src/models/WorkerResponse', () => ({ findOne: jest.fn(() => responseQuery) }));
    jest.doMock('../src/models/OutcomeRecord', () => ({
      findOne: jest.fn(() => existingOutcomeQuery),
      findOneAndUpdate: outcomeUpdate
    }));
    jest.doMock('../src/models/AuditEvent', () => ({ create: auditCreate }));
    jest.doMock('../src/models/Intervention', () => ({ findOne: jest.fn().mockResolvedValue(null) }));
    [
      '../src/models/Approval',
      '../src/models/DecisionQueueItem',
      '../src/models/FollowUpPlan',
      '../src/models/CardFinding',
      '../src/models/BoardHealthSnapshot',
      '../src/models/Board',
      '../src/models/Member',
      '../src/models/List',
      '../src/models/WorkItem'
    ].forEach((modelPath) => jest.doMock(modelPath, () => ({})));
    jest.doMock('../src/services/trelloClient', () => ({}));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn((value) => value || workspaceId)
    }));
    jest.dontMock('../src/services/operationsLedgerService');

    const operationsLedgerService = require('../src/services/operationsLedgerService');
    const result = await operationsLedgerService.evaluateRecommendationOutcome(recommendationId, {
      workspaceId,
      evaluatedBy: 'owner-1'
    });

    expect(result.status).toBe('confirmed_improved');
    expect(outcomeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId, actionAttemptId }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'confirmed_improved',
          summary: 'The approved label is present on the current synced card.',
          evidence: expect.arrayContaining([
            expect.objectContaining({ source: 'card_state' })
          ])
        })
      }),
      expect.objectContaining({ upsert: true })
    );
    expect(JSON.stringify(outcomeUpdate.mock.calls)).not.toContain('responseText');
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'intervention_outcome_evaluated',
      trelloActionAttemptId: actionAttemptId
    }));
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
    jest.dontMock('../src/models/WorkItem');
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

  test('summarizes bounded workspace accountability without response text', async () => {
    jest.resetModules();

    const workspaceId = new mongoose.Types.ObjectId();
    const memberId = new mongoose.Types.ObjectId();
    const membersQuery = {
      select: jest.fn(() => membersQuery),
      sort: jest.fn(() => membersQuery),
      limit: jest.fn(() => membersQuery),
      lean: jest.fn().mockResolvedValue([{
        _id: memberId,
        fullName: 'Nina Jacobs',
        username: 'nina',
        workloadLevel: 'normal'
      }])
    };
    const followUpRows = [{
      _id: memberId,
      followUpsCreated: 4,
      openFollowUps: 2,
      overdueFollowUps: 1,
      respondedFollowUps: 2,
      escalatedFollowUps: 1
    }];
    const responseRows = [{
      _id: memberId,
      responseCount: 3,
      completedResponses: 1,
      blockedResponses: 1,
      needsHelpResponses: 0,
      ignoredResponses: 1
    }];

    jest.doMock('mongoose', () => ({ ...mongoose, connection: { readyState: 1 } }));
    jest.doMock('../src/models/Member', () => ({ find: jest.fn(() => membersQuery) }));
    jest.doMock('../src/models/FollowUpPlan', () => ({ aggregate: jest.fn().mockResolvedValue(followUpRows) }));
    jest.doMock('../src/models/WorkerResponse', () => ({ aggregate: jest.fn().mockResolvedValue(responseRows) }));
    [
      '../src/models/Recommendation',
      '../src/models/Approval',
      '../src/models/TrelloActionAttempt',
      '../src/models/AuditEvent',
      '../src/models/DecisionQueueItem',
      '../src/models/Intervention',
      '../src/models/CardFinding',
      '../src/models/BoardHealthSnapshot',
      '../src/models/Board',
      '../src/models/Card',
      '../src/models/WorkItem'
    ].forEach((modelPath) => jest.doMock(modelPath, () => ({})));
    jest.doMock('../src/services/trelloClient', () => ({}));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn((value) => value || workspaceId)
    }));
    jest.dontMock('../src/services/operationsLedgerService');

    const operationsLedgerService = require('../src/services/operationsLedgerService');
    const result = await operationsLedgerService.getWorkerAccountability({
      workspaceId,
      days: 500,
      limit: 500,
      now: '2026-07-14T12:00:00.000Z'
    });

    expect(result.window.days).toBe(90);
    expect(result.members).toEqual([expect.objectContaining({
      memberId: String(memberId),
      name: 'Nina Jacobs',
      overdueFollowUps: 1,
      escalatedFollowUps: 1,
      blockedResponses: 1,
      ignoredResponses: 1,
      responseCoverage: 50,
      attention: 'needs_attention'
    })]);
    expect(result.summary).toMatchObject({
      members: 1,
      membersNeedingAttention: 1,
      overdueFollowUps: 1,
      escalatedFollowUps: 1,
      recordedResponses: 3,
      explicitlyIgnored: 1
    });
    expect(result.members[0]).not.toHaveProperty('responseText');
    expect(membersQuery.limit).toHaveBeenCalledWith(100);
    expect(require('../src/models/FollowUpPlan').aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ $match: expect.objectContaining({ workspaceId }) })
    ]));
  });

  test('marks overdue scheduled follow-ups due with workspace-scoped audit evidence', async () => {
    jest.resetModules();

    const workspaceId = new mongoose.Types.ObjectId();
    const followUpId = new mongoose.Types.ObjectId();
    const recommendationId = new mongoose.Types.ObjectId();
    const boardId = new mongoose.Types.ObjectId();
    const cardId = new mongoose.Types.ObjectId();
    const memberId = new mongoose.Types.ObjectId();
    const candidate = {
      _id: followUpId,
      workspaceId,
      recommendationId,
      boardId,
      cardId,
      memberId,
      dueAt: new Date('2026-07-14T09:00:00.000Z')
    };
    const dueFollowUp = { ...candidate, status: 'due' };
    const findChain = {
      sort: jest.fn(() => findChain),
      limit: jest.fn().mockResolvedValue([candidate])
    };
    const findOneAndUpdate = jest.fn().mockResolvedValue(dueFollowUp);
    const auditCreate = jest.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

    jest.doMock('mongoose', () => ({ ...mongoose, connection: { readyState: 1 } }));
    jest.doMock('../src/models/FollowUpPlan', () => ({
      find: jest.fn(() => findChain),
      findOneAndUpdate
    }));
    jest.doMock('../src/models/AuditEvent', () => ({ create: auditCreate }));
    [
      '../src/models/Recommendation',
      '../src/models/Approval',
      '../src/models/TrelloActionAttempt',
      '../src/models/DecisionQueueItem',
      '../src/models/WorkerResponse',
      '../src/models/Intervention',
      '../src/models/CardFinding',
      '../src/models/BoardHealthSnapshot',
      '../src/models/Board',
      '../src/models/Card',
      '../src/models/Member',
      '../src/models/WorkItem'
    ].forEach((modelPath) => jest.doMock(modelPath, () => ({})));
    jest.doMock('../src/services/trelloClient', () => ({}));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn((value) => value || workspaceId)
    }));
    jest.dontMock('../src/services/operationsLedgerService');

    const operationsLedgerService = require('../src/services/operationsLedgerService');
    const result = await operationsLedgerService.processDueFollowUps({
      workspaceId,
      now: '2026-07-14T10:00:00.000Z',
      actor: 'scheduler'
    });

    expect(result).toEqual({ scannedCount: 1, markedDue: 1, skippedCount: 0 });
    expect(findOneAndUpdate).toHaveBeenCalledWith({
      _id: followUpId,
      workspaceId,
      status: 'scheduled'
    }, {
      $set: { status: 'due' }
    }, {
      new: true
    });
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'follow_up_plan',
      action: 'follow_up_due',
      actor: 'scheduler',
      afterState: expect.objectContaining({
        workspaceId,
        boardId,
        cardId,
        memberId,
        status: 'due'
      })
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

  test('allows only action-specific payload review fields and keeps Trello targets protected', () => {
    const recommendationPayloadPolicy = require('../src/services/recommendationPayloadPolicy');
    const currentPayload = {
      cardTrelloId: 'trello-card-1',
      cardId: 'card-1',
      source: 'autopilot',
      commentText: 'Please share the next action.',
      executable: true,
      draftOnly: false
    };

    const revised = recommendationPayloadPolicy.applyPatch('comment', currentPayload, {
      commentText: 'Please share the owner, blocker, and next action.'
    });

    expect(revised).toMatchObject({
      cardTrelloId: 'trello-card-1',
      cardId: 'card-1',
      source: 'autopilot',
      commentText: 'Please share the owner, blocker, and next action.',
      executable: true,
      draftOnly: false
    });
    expect(() => recommendationPayloadPolicy.applyPatch('comment', currentPayload, {
      cardTrelloId: 'another-card'
    })).toThrow('protected');
  });

  test('keeps provider-agnostic review drafts non-executable until their exact required fields are present', () => {
    const recommendationPayloadPolicy = require('../src/services/recommendationPayloadPolicy');
    const reassignDraft = {
      cardTrelloId: 'trello-card-1',
      fromMemberTrelloId: 'member-old',
      executable: false,
      draftOnly: true
    };

    const ready = recommendationPayloadPolicy.applyPatch('reassign', reassignDraft, {
      toMemberId: 'member-new-record',
      toMemberTrelloId: 'member-new'
    });

    expect(ready).toMatchObject({
      executable: true,
      draftOnly: false,
      fromMemberTrelloId: 'member-old',
      toMemberTrelloId: 'member-new'
    });
    expect(() => recommendationPayloadPolicy.applyPatch('reassign', reassignDraft, {
      executable: true
    })).toThrow('protected');
  });

  test('prevents graph-derived payloads from becoming provider writes during review', () => {
    const recommendationPayloadPolicy = require('../src/services/recommendationPayloadPolicy');

    expect(() => recommendationPayloadPolicy.applyPatch('escalate', {
      source: 'work_graph',
      externalProviderWriteBlocked: true,
      executable: false,
      draftOnly: true
    }, {
      commentText: 'Please confirm the blocker.'
    })).toThrow('draft-only');
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

describe('command-center response timing telemetry', () => {
  test('keeps only bounded, recent timing samples for approved GET view routes', () => {
    const { ResponseTimingService } = require('../src/services/responseTimingService');
    let now = 100;
    const telemetry = new ResponseTimingService({ now: () => now, maxSamples: 3 });
    const recordRequest = (path, durationMs, statusCode = 200) => {
      const req = { method: 'GET', path };
      const res = new EventEmitter();
      res.statusCode = statusCode;
      const next = jest.fn();
      telemetry.middleware()(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      now += durationMs;
      res.emit('finish');
    };

    recordRequest('/api/autopilot/mission-control', 10);
    recordRequest('/api/autopilot/mission-control', 20);
    recordRequest('/api/autopilot/mission-control', 30, 500);
    recordRequest('/api/autopilot/mission-control', 40);
    recordRequest('/api/cards/private-card', 99);

    const summary = telemetry.getSummary();
    const overview = summary.views.find(view => view.view === 'overview');
    expect(overview).toMatchObject({ samples: 3, averageMs: 30, p50Ms: 30, p95Ms: 40, maxMs: 40, failures: 1 });
    expect(summary).toMatchObject({ retention: 'in_memory_bounded_recent_samples', maxSamplesPerView: 3, sampledViews: 1 });
    expect(JSON.stringify(summary)).not.toContain('private-card');
  });

  test('does not instrument mutations or unknown API routes', () => {
    const { ResponseTimingService } = require('../src/services/responseTimingService');
    const telemetry = new ResponseTimingService({ maxSamples: 10 });
    expect(telemetry.getView({ method: 'POST', path: '/api/recommendations' })).toBeNull();
    expect(telemetry.getView({ method: 'GET', path: '/api/cards/private-card' })).toBeNull();
    expect(telemetry.getView({ method: 'GET', path: '/api/connectors' })).toBe('connectors');
  });
});

describe('bounded API rate limiting', () => {
  test('prunes aggregate bucket state before admitting unbounded route diversity', () => {
    let now = 1000;
    const limiter = createApiRateLimiter({
      now: () => now,
      maxBuckets: 3,
      pruneSlack: 1,
      maxRequests: 5,
      windowMs: 60000
    });
    const request = (path, ip) => createRequest({
      path,
      ip,
      connection: { remoteAddress: ip },
      socket: { remoteAddress: ip }
    });

    for (let index = 0; index < 4; index += 1) {
      const req = request(`/api/boards/${index}`, `203.0.113.${index + 1}`);
      const res = createResponse();
      limiter(req, res, jest.fn());
      now += 1;
    }

    const metrics = limiter.getMetrics();
    expect(metrics).toMatchObject({
      retention: 'in_memory_bounded_rate_buckets',
      maxBuckets: 3,
      pruneSlack: 1,
      bucketCount: 2,
      leastRecentlyUsedBucketsPruned: 2
    });
    expect(JSON.stringify(metrics)).not.toContain('203.0.113');
    expect(JSON.stringify(metrics)).not.toContain('/api/boards');
  });

  test('keeps rate enforcement while reporting only aggregate rejected-request pressure', () => {
    const limiter = createApiRateLimiter({ maxBuckets: 3, pruneSlack: 1, maxRequests: 1 });
    const first = createResponse();
    const second = createResponse();

    limiter(createRequest(), first, jest.fn());
    limiter(createRequest(), second, jest.fn());

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(limiter.getMetrics()).toMatchObject({ rejectedRequests: 1, bucketCount: 1 });
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
