const crypto = require('crypto');
const mongoose = require('mongoose');
const logger = require('./logger');
const { isDatabaseConnected } = require('./database');

const rateBuckets = new Map();
const MAX_RATE_BUCKETS = Number(process.env.SNEUP_RATE_LIMIT_MAX_BUCKETS || 10000);
const RATE_BUCKET_PRUNE_SLACK = Number(process.env.SNEUP_RATE_LIMIT_PRUNE_SLACK || 2500);

const pruneRateBuckets = (now = Date.now()) => {
  if (rateBuckets.size <= MAX_RATE_BUCKETS) {
    return;
  }

  for (const [bucketKey, value] of rateBuckets.entries()) {
    if (value.resetAt <= now) {
      rateBuckets.delete(bucketKey);
    }
  }

  if (rateBuckets.size <= MAX_RATE_BUCKETS) {
    return;
  }

  const sorted = [...rateBuckets.entries()]
    .map(([bucketKey, value]) => ({
      bucketKey,
      lastSeenAt: value.lastSeenAt || value.resetAt || 0
    }))
    .sort((left, right) => left.lastSeenAt - right.lastSeenAt);

  const targetSize = Math.max(128, MAX_RATE_BUCKETS - RATE_BUCKET_PRUNE_SLACK);
  const removeCount = Math.max(1, rateBuckets.size - targetSize);
  sorted.slice(0, removeCount).forEach((entry) => {
    rateBuckets.delete(entry.bucketKey);
  });
};

const localAddresses = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1'
]);

const ALL_PERMISSIONS = Object.freeze([
  'api:read',
  'analysis:run',
  'approvals:decide',
  'audit:read',
  'autopilot:queue',
  'capacity:manage',
  'chat:write',
  'connectors:manage',
  'decision-queue:manage',
  'follow-ups:manage',
  'identity:manage',
  'jobs:manage',
  'recommendations:review',
  'sync:run',
  'trello-actions:execute-approved',
  'trello-actions:reconcile',
  'worker-responses:record'
]);

const ROLE_PERMISSIONS = Object.freeze({
  viewer: ['api:read', 'audit:read'],
  operator: [
    'api:read',
    'analysis:run',
    'audit:read',
    'chat:write',
    'decision-queue:manage',
    'follow-ups:manage',
    'recommendations:review',
    'worker-responses:record'
  ],
  manager: [
    'api:read',
    'analysis:run',
    'approvals:decide',
    'audit:read',
    'capacity:manage',
    'autopilot:queue',
    'chat:write',
    'decision-queue:manage',
    'follow-ups:manage',
    'jobs:manage',
    'recommendations:review',
    'sync:run',
    'trello-actions:execute-approved',
    'trello-actions:reconcile',
    'worker-responses:record'
  ],
  admin: ALL_PERMISSIONS,
  owner: ALL_PERMISSIONS,
  service: ALL_PERMISSIONS
});

const getDefaultWorkspaceId = () => process.env.SNEUP_DEFAULT_WORKSPACE_ID || 'default';
const getDefaultWorkspaceName = () => process.env.SNEUP_DEFAULT_WORKSPACE_NAME || 'Sneup Local Workspace';
const getServiceActor = () => process.env.SNEUP_SERVICE_ACTOR || 'sneup-api-service';

const asIdString = (value) => {
  if (!value) return null;
  if (value._id) return String(value._id);
  return String(value);
};

const unique = (items) => [...new Set(items.filter(Boolean))];

const getPermissionsForRoles = (roles = []) => unique(
  roles.flatMap(role => ROLE_PERMISSIONS[role] || [])
);

const hasPermission = (auth, permission) => {
  if (!auth) return false;
  const permissions = new Set([
    ...(auth.permissions || []),
    ...getPermissionsForRoles(auth.roles || [])
  ]);
  return permissions.has(permission);
};

const canOverrideWorkspace = (req, overrides = {}) => {
  const actorType = overrides.actorType || 'service';
  const roles = overrides.roles || ['service'];
  return isLocalRequest(req) || actorType === 'service' || roles.includes('owner');
};

const buildAuthContext = (req, overrides = {}) => {
  const roles = overrides.roles || ['service'];
  const requestedWorkspaceId = req.get('x-sneup-workspace-id');
  const workspaceOverrideAllowed = requestedWorkspaceId && canOverrideWorkspace(req, { ...overrides, roles });
  const workspaceId = workspaceOverrideAllowed
    ? requestedWorkspaceId
    : overrides.workspaceId || getDefaultWorkspaceId();
  return {
    authenticated: true,
    authMethod: overrides.authMethod || 'api_key',
    actorType: overrides.actorType || 'service',
    actorId: overrides.actorId || getServiceActor(),
    displayName: overrides.displayName || 'Sneup API service',
    workspaceId,
    workspaceName: workspaceOverrideAllowed
      ? req.get('x-sneup-workspace-name') || requestedWorkspaceId
      : overrides.workspaceName || getDefaultWorkspaceName(),
    roles,
    permissions: overrides.permissions || getPermissionsForRoles(roles),
    tokenId: overrides.tokenId || null,
    userId: overrides.userId || null,
    localRequest: isLocalRequest(req),
    remoteAddress: getClientIp(req),
    authenticatedAt: new Date().toISOString(),
    workspaceOverrideAllowed: Boolean(workspaceOverrideAllowed)
  };
};

const attachAuthContext = (req, context) => {
  req.auth = Object.freeze(context);
  return req.auth;
};

const getClientIp = (req) => {
  const rawIp = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '';
  return rawIp.replace(/^::ffff:/, '');
};

const isLocalRequest = (req) => {
  const ip = getClientIp(req);
  return localAddresses.has(ip) || ip.startsWith('127.');
};

const extractApiKey = (req) => {
  const explicit = req.get('x-sneup-api-key');
  if (explicit) return explicit;

  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
};

const safeEquals = (left, right) => {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const isOAuthCallback = (req) =>
  req.method === 'GET' && /^\/api\/connectors\/[^/]+\/callback$/.test(req.path);

const isWebhook = (req) =>
  req.path === '/api/webhooks/trello' && ['HEAD', 'POST'].includes(req.method);

const isPublicInviteAcceptance = (req) =>
  req.method === 'POST' && req.path === '/api/workspaces/invitations/accept';

const resolveDatabaseApiToken = async (providedKey, now = new Date()) => {
  if (!providedKey || !isDatabaseConnected()) return null;

  const ApiToken = require('../models/ApiToken');
  const tokenPrefix = ApiToken.prefixFor(providedKey);
  const candidate = await ApiToken.findOne({
    tokenPrefix,
    status: 'active'
  })
    .select('+tokenHash')
    .populate('workspaceId')
    .populate('userId');

  if (!candidate || !candidate.isUsable(now) || !candidate.matches(providedKey)) {
    return null;
  }

  const user = candidate.userId;
  if (user && user.status !== 'active') {
    return null;
  }

  candidate.lastUsedAt = now;
  await candidate.save();

  const workspace = candidate.workspaceId;
  const role = user?.role || candidate.role || 'service';

  return {
    token: candidate,
    user,
    workspace,
    context: {
      authMethod: 'database_api_token',
      actorType: user ? 'user' : 'service',
      actorId: asIdString(user) || asIdString(candidate),
      displayName: user?.displayName || candidate.name || 'Sneup API token',
      workspaceId: asIdString(workspace) || getDefaultWorkspaceId(),
      workspaceName: workspace?.name || getDefaultWorkspaceName(),
      roles: [role],
      permissions: candidate.scopes?.length ? candidate.scopes : undefined,
      tokenId: asIdString(candidate),
      userId: asIdString(user)
    }
  };
};

const resolveDatabaseSessionToken = async (providedKey, now = new Date()) => {
  if (!providedKey || !isDatabaseConnected()) return null;

  const SessionToken = require('../models/SessionToken');
  const tokenPrefix = SessionToken.prefixFor(providedKey);
  const candidate = await SessionToken.findOne({
    tokenPrefix,
    status: 'active'
  })
    .select('+tokenHash')
    .populate('workspaceId')
    .populate('userId');

  if (!candidate || !candidate.isUsable(now) || !candidate.matches(providedKey)) {
    return null;
  }

  const user = candidate.userId;
  const workspace = candidate.workspaceId;
  if (!user || user.status !== 'active' || !workspace) {
    return null;
  }

  candidate.lastUsedAt = now;
  await candidate.save();

  user.lastSeenAt = now;
  await user.save();

  const role = user.role || 'viewer';

  return {
    token: candidate,
    user,
    workspace,
    context: {
      authMethod: 'database_session',
      actorType: 'user',
      actorId: asIdString(user),
      displayName: user.displayName || user.email || 'Sneup user',
      workspaceId: asIdString(workspace),
      workspaceName: workspace.name || getDefaultWorkspaceName(),
      roles: [role],
      tokenId: asIdString(candidate),
      userId: asIdString(user)
    }
  };
};

const requireApiAccess = async (req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  if (isOAuthCallback(req) || isWebhook(req) || isPublicInviteAcceptance(req)) {
    attachAuthContext(req, buildAuthContext(req, {
      authMethod: isWebhook(req) ? 'trello_webhook' : isPublicInviteAcceptance(req) ? 'invite_acceptance' : 'oauth_callback',
      actorType: isPublicInviteAcceptance(req) ? 'invite_recipient' : 'external_system',
      actorId: isWebhook(req) ? 'trello' : isPublicInviteAcceptance(req) ? 'pending-invite' : 'connector-oauth',
      displayName: isWebhook(req) ? 'Trello webhook' : isPublicInviteAcceptance(req) ? 'Invitation recipient' : 'Connector OAuth callback',
      roles: isPublicInviteAcceptance(req) ? [] : ['service'],
      permissions: isPublicInviteAcceptance(req) ? [] : ['webhooks:receive', 'connectors:complete-oauth']
    }));
    return next();
  }

  const configuredKey = process.env.SNEUP_API_KEY;
  const providedKey = extractApiKey(req);

  if (configuredKey && safeEquals(providedKey, configuredKey)) {
    attachAuthContext(req, buildAuthContext(req));
    return next();
  }

  try {
    const databaseToken = await resolveDatabaseApiToken(providedKey);
    if (databaseToken) {
      attachAuthContext(req, buildAuthContext(req, databaseToken.context));
      return next();
    }

    const databaseSession = await resolveDatabaseSessionToken(providedKey);
    if (databaseSession) {
      attachAuthContext(req, buildAuthContext(req, databaseSession.context));
      return next();
    }
  } catch (error) {
    logger.error('Failed to resolve Sneup database API credential:', error);
    return res.status(503).json({
      success: false,
      error: 'Sneup credential verification is temporarily unavailable'
    });
  }

  const localBypassAllowed = process.env.SNEUP_REQUIRE_API_KEY !== 'true' && isLocalRequest(req);
  if (localBypassAllowed) {
    attachAuthContext(req, buildAuthContext(req, {
      authMethod: 'local_bypass',
      actorType: 'local_user',
      actorId: process.env.SNEUP_LOCAL_ACTOR || 'local-user',
      displayName: process.env.SNEUP_LOCAL_ACTOR_NAME || 'Local Sneup user',
      roles: ['owner']
    }));
    return next();
  }

  if (!configuredKey) {
    return res.status(503).json({
      success: false,
      error: 'SNEUP_API_KEY or an active database API token must be configured before remote API access is allowed'
    });
  }

  return res.status(401).json({
    success: false,
    error: 'Valid Sneup API key required'
  });
};

const apiRateLimit = (req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  const windowMs = Number(process.env.SNEUP_RATE_LIMIT_WINDOW_MS || 60 * 1000);
  const maxRequests = Number(process.env.SNEUP_RATE_LIMIT_MAX || (isLocalRequest(req) ? 600 : 120));
  const now = Date.now();
  const key = `${getClientIp(req)}:${req.path.split('/').slice(0, 3).join('/')}`;
  const bucket = rateBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs, lastSeenAt: now });
    pruneRateBuckets(now);
    return next();
  }

  bucket.count += 1;
  bucket.lastSeenAt = now;
  if (bucket.count > maxRequests) {
    return res.status(429).json({
      success: false,
      error: 'Too many requests. Please wait a moment and try again.'
    });
  }

  if (rateBuckets.size > MAX_RATE_BUCKETS) {
    pruneRateBuckets(now);
  }

  return next();
};

const buildAllowedOrigins = () => {
  const localPort = String(process.env.PORT || 3000).trim();
  const configured = (process.env.SNEUP_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  return new Set([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    `http://localhost:${localPort}`,
    `http://127.0.0.1:${localPort}`,
    ...configured
  ]);
};

let allowedOriginsCache = {
  source: '',
  set: null
};

const getAllowedOrigins = () => {
  const source = `${process.env.PORT || 3000}:${process.env.SNEUP_ALLOWED_ORIGINS || ''}`;
  if (allowedOriginsCache.source !== source || !allowedOriginsCache.set) {
    allowedOriginsCache = {
      source,
      set: buildAllowedOrigins()
    };
  }
  return allowedOriginsCache.set;
};

const corsOptions = {
  origin(origin, callback) {
    if (!origin || getAllowedOrigins().has(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin is not allowed by Sneup CORS policy'));
  },
  methods: ['GET', 'POST', 'DELETE', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Sneup-Api-Key', 'X-Sneup-Workspace-Id', 'X-Sneup-Workspace-Name', 'X-Trello-Webhook'],
  credentials: false
};

const requirePermission = (permission) => (req, res, next) => {
  if (!req.auth?.authenticated) {
    return res.status(401).json({
      success: false,
      error: 'Authenticated Sneup API context required'
    });
  }

  if (!hasPermission(req.auth, permission)) {
    return res.status(403).json({
      success: false,
      error: 'Sneup role does not allow this action',
      requiredPermission: permission
    });
  }

  return next();
};

const validateObjectIdParam = (paramName) => (req, res, next) => {
  const value = req.params[paramName];
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return res.status(400).json({
      success: false,
      error: `Invalid ${paramName}`
    });
  }
  return next();
};

const clampInteger = (value, defaultValue, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, parsed));
};

const verifyTrelloWebhook = (req, res, next) => {
  const secret = process.env.TRELLO_WEBHOOK_SECRET;
  const callbackUrl = process.env.WEBHOOK_CALLBACK_URL;

  if (!secret || !callbackUrl) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        success: false,
        error: 'Trello webhook verification is not configured'
      });
    }

    logger.warn('Trello webhook signature verification skipped because TRELLO_WEBHOOK_SECRET or WEBHOOK_CALLBACK_URL is not configured.');
    return next();
  }

  const providedSignature = req.get('x-trello-webhook');
  if (!providedSignature || !req.rawBody) {
    return res.status(401).json({
      success: false,
      error: 'Missing Trello webhook signature'
    });
  }

  const payload = Buffer.concat([req.rawBody, Buffer.from(callbackUrl)]);
  const expectedSignature = crypto
    .createHmac('sha1', secret)
    .update(payload)
    .digest('base64');

  if (!safeEquals(providedSignature, expectedSignature)) {
    return res.status(401).json({
      success: false,
      error: 'Invalid Trello webhook signature'
    });
  }

  return next();
};

module.exports = {
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  apiRateLimit,
  buildAuthContext,
  clampInteger,
  corsOptions,
  extractApiKey,
  getPermissionsForRoles,
  hasPermission,
  isPublicInviteAcceptance,
  requireApiAccess,
  requirePermission,
  resolveDatabaseApiToken,
  resolveDatabaseSessionToken,
  validateObjectIdParam,
  verifyTrelloWebhook
};
