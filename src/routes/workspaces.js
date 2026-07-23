const express = require('express');
const mongoose = require('mongoose');
const Workspace = require('../models/Workspace');
const User = require('../models/User');
const SessionToken = require('../models/SessionToken');
const operationsLedgerService = require('../services/operationsLedgerService');
const workspaceInviteService = require('../services/workspaceInviteService');
const {
  getDemoSecurityContext,
  getDemoWorkspace,
  isDemoMode
} = require('../services/demoWorkspaceService');
const {
  getRequestWorkspaceObjectId,
  slugifyWorkspaceKey
} = require('../services/workspaceScopeService');
const {
  clampInteger,
  requirePermission,
  validateObjectIdParam
} = require('../utils/requestSecurity');
const logger = require('../utils/logger');

const router = express.Router();

router.param('userId', validateObjectIdParam('userId'));
router.param('sessionId', validateObjectIdParam('sessionId'));
router.param('inviteId', validateObjectIdParam('inviteId'));

const USER_ROLES = ['viewer', 'operator', 'manager', 'admin', 'owner', 'service'];
const USER_STATUSES = ['active', 'invited', 'disabled'];
const WORKSPACE_STATUSES = ['active', 'suspended', 'archived'];
const WORKSPACE_PLANS = ['local', 'team', 'enterprise'];

const toWorkspaceQuery = (workspaceIdOrSlug) => {
  if (mongoose.Types.ObjectId.isValid(workspaceIdOrSlug)) {
    return { _id: workspaceIdOrSlug };
  }
  return { slug: slugifyWorkspaceKey(workspaceIdOrSlug) };
};

const publicWorkspace = (workspace) => ({
  id: String(workspace._id),
  name: workspace.name,
  slug: workspace.slug,
  status: workspace.status,
  plan: workspace.plan,
  settings: workspace.settings,
  createdAt: workspace.createdAt,
  updatedAt: workspace.updatedAt
});

const publicUser = (user) => ({
  id: String(user._id),
  workspaceId: user.workspaceId ? String(user.workspaceId) : null,
  externalId: user.externalId || null,
  email: user.email || null,
  displayName: user.displayName,
  role: user.role,
  status: user.status,
  provider: user.provider,
  lastSeenAt: user.lastSeenAt || null,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt
});

const publicSession = (session) => ({
  id: String(session._id),
  workspaceId: session.workspaceId ? String(session.workspaceId) : null,
  userId: session.userId ? String(session.userId) : null,
  name: session.name,
  tokenPrefix: session.tokenPrefix,
  status: session.status,
  lastUsedAt: session.lastUsedAt || null,
  expiresAt: session.expiresAt,
  createdBy: session.createdBy,
  revokedAt: session.revokedAt || null,
  revokedBy: session.revokedBy || null,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt
});

const findWorkspaceOr404 = async (workspaceIdOrSlug) => {
  const workspace = await Workspace.findOne(toWorkspaceQuery(workspaceIdOrSlug));
  if (!workspace) {
    const error = new Error('Workspace not found');
    error.statusCode = 404;
    throw error;
  }
  return workspace;
};

const findWorkspaceUserOr404 = async (workspace, userId) => {
  const user = await User.findOne({ _id: userId, workspaceId: workspace._id });
  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }
  return user;
};

const validateEnum = (value, allowed, field, fallback) => {
  if (!value) return fallback;
  if (!allowed.includes(value)) {
    const error = new Error(`${field} must be one of: ${allowed.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  return value;
};

router.get('/current', requirePermission('api:read'), async (req, res) => {
  try {
    if (isDemoMode()) {
      return res.json({
        success: true,
        workspace: getDemoWorkspace(),
        auth: getDemoSecurityContext()
      });
    }

    const workspaceId = getRequestWorkspaceObjectId(req);
    const workspace = await Workspace.findById(workspaceId);
    res.json({
      success: true,
      workspace: workspace ? publicWorkspace(workspace) : {
        id: String(workspaceId),
        name: req.auth?.workspaceName || 'Current workspace',
        slug: slugifyWorkspaceKey(req.auth?.workspaceId || workspaceId),
        status: 'active',
        plan: 'local',
        settings: {}
      },
      auth: {
        actorId: req.auth?.actorId,
        displayName: req.auth?.displayName,
        roles: req.auth?.roles || [],
        permissions: req.auth?.permissions || [],
        workspaceOverrideAllowed: Boolean(req.auth?.workspaceOverrideAllowed || req.auth?.localRequest)
      }
    });
  } catch (error) {
    logger.error('Failed to read current workspace:', error);
    res.status(500).json({ success: false, error: 'Failed to read current workspace' });
  }
});

router.post('/invitations/accept', async (req, res) => {
  try {
    const result = await workspaceInviteService.acceptInvite({
      rawToken: req.body.token,
      displayName: req.body.displayName
    });
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    logger.warn('Workspace invitation acceptance failed', { statusCode: error.statusCode || 500 });
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Invitation acceptance failed'
    });
  }
});

router.get('/', requirePermission('identity:manage'), async (req, res) => {
  try {
    const limit = clampInteger(req.query.limit, 100, 1, 500);
    const query = {};
    if (req.query.status) {
      query.status = validateEnum(req.query.status, WORKSPACE_STATUSES, 'status');
    }

    const workspaces = await Workspace.find(query)
      .sort({ status: 1, name: 1 })
      .limit(limit);

    res.json({
      success: true,
      count: workspaces.length,
      currentWorkspaceId: String(getRequestWorkspaceObjectId(req)),
      workspaces: workspaces.map(publicWorkspace)
    });
  } catch (error) {
    logger.error('Failed to list workspaces:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to list workspaces'
    });
  }
});

router.post('/', requirePermission('identity:manage'), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, error: 'Workspace name is required' });
    }

    const slug = slugifyWorkspaceKey(req.body.slug || name);
    const plan = validateEnum(req.body.plan, WORKSPACE_PLANS, 'plan', 'team');
    const status = validateEnum(req.body.status, WORKSPACE_STATUSES, 'status', 'active');

    const workspace = await Workspace.create({
      name,
      slug,
      plan,
      status,
      settings: {
        requireApprovalForTrelloWrites: req.body.requireApprovalForTrelloWrites !== false,
        defaultDecisionOwner: validateEnum(req.body.defaultDecisionOwner, ['robert', 'va', 'team', 'system'], 'defaultDecisionOwner', 'robert')
      },
      metadata: {
        ...(req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {}),
        createdVia: 'workspace_admin_api',
        createdBy: req.auth?.actorId
      }
    });

    await operationsLedgerService.recordAudit({
      workspaceId: workspace._id,
      entityType: 'workspace',
      entityId: workspace._id,
      action: 'workspace_created',
      actor: req.auth?.actorId || 'sneup',
      source: 'api',
      riskLevel: 'medium',
      afterState: publicWorkspace(workspace)
    });

    res.status(201).json({ success: true, workspace: publicWorkspace(workspace) });
  } catch (error) {
    logger.error('Failed to create workspace:', error);
    res.status(error.code === 11000 ? 409 : error.statusCode || 500).json({
      success: false,
      error: error.code === 11000 ? 'Workspace slug already exists' : error.statusCode ? error.message : 'Failed to create workspace'
    });
  }
});

router.post('/:workspaceId/update', requirePermission('identity:manage'), async (req, res) => {
  try {
    const workspace = await findWorkspaceOr404(req.params.workspaceId);
    const beforeState = publicWorkspace(workspace);

    if (req.body.name) workspace.name = String(req.body.name).trim();
    if (req.body.status) workspace.status = validateEnum(req.body.status, WORKSPACE_STATUSES, 'status');
    if (req.body.plan) workspace.plan = validateEnum(req.body.plan, WORKSPACE_PLANS, 'plan');
    if (req.body.settings && typeof req.body.settings === 'object') {
      workspace.settings = {
        ...(workspace.settings || {}),
        ...req.body.settings
      };
    }
    await workspace.save();

    await operationsLedgerService.recordAudit({
      workspaceId: workspace._id,
      entityType: 'workspace',
      entityId: workspace._id,
      action: 'workspace_updated',
      actor: req.auth?.actorId || 'sneup',
      source: 'api',
      riskLevel: 'medium',
      beforeState,
      afterState: publicWorkspace(workspace)
    });

    res.json({ success: true, workspace: publicWorkspace(workspace) });
  } catch (error) {
    logger.error('Failed to update workspace:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to update workspace'
    });
  }
});

router.get('/:workspaceId/users', requirePermission('identity:manage'), async (req, res) => {
  try {
    const workspace = await findWorkspaceOr404(req.params.workspaceId);
    const users = await User.find({ workspaceId: workspace._id })
      .sort({ status: 1, role: 1, displayName: 1 })
      .limit(clampInteger(req.query.limit, 100, 1, 500));

    res.json({
      success: true,
      workspace: publicWorkspace(workspace),
      count: users.length,
      users: users.map(publicUser)
    });
  } catch (error) {
    logger.error('Failed to list workspace users:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to list workspace users'
    });
  }
});

router.post('/:workspaceId/users', requirePermission('identity:manage'), async (req, res) => {
  try {
    const workspace = await findWorkspaceOr404(req.params.workspaceId);
    const displayName = String(req.body.displayName || '').trim();
    if (!displayName) {
      return res.status(400).json({ success: false, error: 'displayName is required' });
    }

    const user = await User.create({
      workspaceId: workspace._id,
      externalId: req.body.externalId || undefined,
      email: req.body.email || undefined,
      displayName,
      role: validateEnum(req.body.role, USER_ROLES, 'role', 'viewer'),
      status: validateEnum(req.body.status, USER_STATUSES, 'status', 'invited'),
      provider: req.body.provider || 'local',
      metadata: req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {}
    });

    await operationsLedgerService.recordAudit({
      workspaceId: workspace._id,
      entityType: 'user',
      entityId: user._id,
      action: 'workspace_user_created',
      actor: req.auth?.actorId || 'sneup',
      source: 'api',
      riskLevel: 'medium',
      afterState: publicUser(user)
    });

    res.status(201).json({ success: true, user: publicUser(user) });
  } catch (error) {
    logger.error('Failed to create workspace user:', error);
    res.status(error.code === 11000 ? 409 : error.statusCode || 500).json({
      success: false,
      error: error.code === 11000 ? 'User email already exists in this workspace' : error.statusCode ? error.message : 'Failed to create workspace user'
    });
  }
});

router.get('/:workspaceId/invitations', requirePermission('identity:manage'), async (req, res) => {
  try {
    const workspace = await findWorkspaceOr404(req.params.workspaceId);
    const invitations = await workspaceInviteService.listInvites({
      workspaceId: workspace._id,
      limit: req.query.limit
    });
    res.json({
      success: true,
      workspace: publicWorkspace(workspace),
      count: invitations.length,
      invitations: invitations.map(workspaceInviteService.publicInvite)
    });
  } catch (error) {
    logger.error('Failed to list workspace invitations:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to list workspace invitations'
    });
  }
});

router.post('/:workspaceId/invitations', requirePermission('identity:manage'), async (req, res) => {
  try {
    const workspace = await findWorkspaceOr404(req.params.workspaceId);
    const result = await workspaceInviteService.createInvite({
      workspace,
      actor: req.auth?.actorId || 'sneup',
      email: req.body.email,
      displayName: req.body.displayName,
      role: req.body.role,
      expiresInDays: req.body.expiresInDays,
      deliveryMode: req.body.deliveryMode
    });
    res.status(201).json({
      success: true,
      invite: result.invite,
      inviteUrl: result.inviteUrl,
      delivery: result.delivery,
      user: publicUser(result.user)
    });
  } catch (error) {
    logger.error('Failed to create workspace invitation:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to create workspace invitation'
    });
  }
});

router.post('/:workspaceId/invitations/:inviteId/retry-delivery', requirePermission('identity:manage'), async (req, res) => {
  try {
    const workspace = await findWorkspaceOr404(req.params.workspaceId);
    const result = await workspaceInviteService.retryInviteDelivery({
      workspaceId: workspace._id,
      inviteId: req.params.inviteId,
      actor: req.auth?.actorId || 'sneup'
    });
    res.json({
      success: true,
      invite: result.invite,
      inviteUrl: result.inviteUrl,
      delivery: result.delivery,
      replacedInviteId: result.replacedInviteId,
      user: publicUser(result.user)
    });
  } catch (error) {
    logger.error('Failed to retry workspace invitation delivery:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to retry workspace invitation delivery'
    });
  }
});

router.post('/:workspaceId/invitations/:inviteId/revoke', requirePermission('identity:manage'), async (req, res) => {
  try {
    const workspace = await findWorkspaceOr404(req.params.workspaceId);
    const invite = await workspaceInviteService.revokeInvite({
      workspaceId: workspace._id,
      inviteId: req.params.inviteId,
      actor: req.auth?.actorId || 'sneup'
    });
    res.json({
      success: true,
      invite: workspaceInviteService.publicInvite(invite),
      workspace: publicWorkspace(workspace)
    });
  } catch (error) {
    logger.error('Failed to revoke workspace invitation:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to revoke workspace invitation'
    });
  }
});

router.post('/:workspaceId/users/:userId/update', requirePermission('identity:manage'), async (req, res) => {
  try {
    const workspace = await findWorkspaceOr404(req.params.workspaceId);
    const user = await findWorkspaceUserOr404(workspace, req.params.userId);

    const beforeState = publicUser(user);
    if (req.body.displayName) user.displayName = String(req.body.displayName).trim();
    if (req.body.email !== undefined) user.email = req.body.email || undefined;
    if (req.body.role) user.role = validateEnum(req.body.role, USER_ROLES, 'role');
    if (req.body.status) user.status = validateEnum(req.body.status, USER_STATUSES, 'status');
    if (req.body.metadata && typeof req.body.metadata === 'object') {
      user.metadata = { ...(user.metadata || {}), ...req.body.metadata };
    }
    await user.save();

    await operationsLedgerService.recordAudit({
      workspaceId: workspace._id,
      entityType: 'user',
      entityId: user._id,
      action: 'workspace_user_updated',
      actor: req.auth?.actorId || 'sneup',
      source: 'api',
      riskLevel: 'medium',
      beforeState,
      afterState: publicUser(user)
    });

    res.json({ success: true, user: publicUser(user) });
  } catch (error) {
    logger.error('Failed to update workspace user:', error);
    res.status(error.code === 11000 ? 409 : error.statusCode || 500).json({
      success: false,
      error: error.code === 11000 ? 'User email already exists in this workspace' : error.statusCode ? error.message : 'Failed to update workspace user'
    });
  }
});

router.get('/:workspaceId/users/:userId/sessions', requirePermission('identity:manage'), async (req, res) => {
  try {
    const workspace = await findWorkspaceOr404(req.params.workspaceId);
    const user = await findWorkspaceUserOr404(workspace, req.params.userId);
    const sessions = await SessionToken.find({
      workspaceId: workspace._id,
      userId: user._id
    })
      .sort({ status: 1, lastUsedAt: -1, createdAt: -1 })
      .limit(clampInteger(req.query.limit, 100, 1, 500));

    res.json({
      success: true,
      workspace: publicWorkspace(workspace),
      user: publicUser(user),
      count: sessions.length,
      sessions: sessions.map(publicSession)
    });
  } catch (error) {
    logger.error('Failed to list workspace user sessions:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to list workspace user sessions'
    });
  }
});

router.post('/:workspaceId/users/:userId/session', requirePermission('identity:manage'), async (req, res) => {
  try {
    const workspace = await findWorkspaceOr404(req.params.workspaceId);
    const user = await findWorkspaceUserOr404(workspace, req.params.userId);
    if (user.status !== 'active') {
      return res.status(409).json({
        success: false,
        error: 'User must be active before a session token can be issued'
      });
    }

    const expiresInHours = clampInteger(req.body.expiresInHours, 168, 1, 24 * 90);
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    const rawToken = SessionToken.generateRawToken();
    const session = await SessionToken.create(SessionToken.buildSecretRecord(rawToken, {
      workspaceId: workspace._id,
      userId: user._id,
      name: String(req.body.name || `${user.displayName} session`).trim(),
      expiresAt,
      createdBy: req.auth?.actorId || 'sneup',
      metadata: req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {}
    }));

    await operationsLedgerService.recordAudit({
      workspaceId: workspace._id,
      entityType: 'session_token',
      entityId: session._id,
      action: 'workspace_user_session_issued',
      actor: req.auth?.actorId || 'sneup',
      source: 'api',
      riskLevel: 'high',
      afterState: publicSession(session)
    });

    res.status(201).json({
      success: true,
      session: publicSession(session),
      sessionToken: rawToken,
      authorizationHeader: `Bearer ${rawToken}`,
      user: publicUser(user),
      workspace: publicWorkspace(workspace)
    });
  } catch (error) {
    logger.error('Failed to issue workspace user session:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to issue workspace user session'
    });
  }
});

router.post('/:workspaceId/users/:userId/sessions/:sessionId/revoke', requirePermission('identity:manage'), async (req, res) => {
  try {
    const workspace = await findWorkspaceOr404(req.params.workspaceId);
    const user = await findWorkspaceUserOr404(workspace, req.params.userId);
    const session = await SessionToken.findOne({
      _id: req.params.sessionId,
      workspaceId: workspace._id,
      userId: user._id
    });

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const beforeState = publicSession(session);
    await session.revoke(req.auth?.actorId || 'sneup');

    await operationsLedgerService.recordAudit({
      workspaceId: workspace._id,
      entityType: 'session_token',
      entityId: session._id,
      action: 'workspace_user_session_revoked',
      actor: req.auth?.actorId || 'sneup',
      source: 'api',
      riskLevel: 'high',
      beforeState,
      afterState: publicSession(session)
    });

    res.json({
      success: true,
      session: publicSession(session),
      user: publicUser(user),
      workspace: publicWorkspace(workspace)
    });
  } catch (error) {
    logger.error('Failed to revoke workspace user session:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to revoke workspace user session'
    });
  }
});

module.exports = router;
