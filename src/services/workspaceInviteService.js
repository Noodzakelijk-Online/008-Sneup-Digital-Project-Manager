const WorkspaceInvite = require('../models/WorkspaceInvite');
const User = require('../models/User');
const SessionToken = require('../models/SessionToken');
const operationsLedgerService = require('./operationsLedgerService');
const { clampInteger } = require('../utils/requestSecurity');
const { isProduction } = require('../utils/securityConfiguration');
const logger = require('../utils/logger');

const USER_ROLES = ['viewer', 'operator', 'manager', 'admin', 'owner', 'service'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_DELIVERY_TIMEOUT_MS = 15000;
const TERMINAL_INVITE_STATUSES = ['accepted', 'revoked', 'expired'];
const DEFAULT_INVITE_RETENTION_DAYS = 90;
const MIN_INVITE_RETENTION_DAYS = 7;
const MAX_INVITE_RETENTION_DAYS = 3650;
const DEFAULT_INVITE_RETENTION_BATCH_SIZE = 100;
const MAX_INVITE_RETENTION_BATCH_SIZE = 250;

const invitationError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const assertEmailDeliveryConfigured = (environment = process.env) => {
  if (!environment.RESEND_API_KEY || !environment.SNEUP_INVITE_FROM) {
    throw invitationError('Email delivery is not configured. Set RESEND_API_KEY and SNEUP_INVITE_FROM, or use a manual invitation link.', 503);
  }
};

const validateInviteInput = ({ email, displayName, role }) => {
  const normalizedEmail = normalizeEmail(email);
  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    throw invitationError('A valid invitation email is required');
  }

  const normalizedDisplayName = String(displayName || '').trim();
  if (!normalizedDisplayName) {
    throw invitationError('A display name is required');
  }

  if (!USER_ROLES.includes(role || 'viewer')) {
    throw invitationError(`role must be one of: ${USER_ROLES.join(', ')}`);
  }

  return {
    email: normalizedEmail,
    displayName: normalizedDisplayName,
    role: role || 'viewer'
  };
};

const publicInvite = (invite) => {
  const redacted = Boolean(invite.redactedAt);
  return {
  id: String(invite._id),
  workspaceId: String(invite.workspaceId),
  userId: String(invite.userId),
  email: redacted ? '' : invite.email,
  displayName: redacted ? '' : invite.displayName,
  role: invite.role,
  tokenPrefix: redacted ? '' : invite.tokenPrefix,
  status: invite.status,
  expiresAt: invite.expiresAt,
  createdBy: invite.createdBy,
  acceptedAt: invite.acceptedAt || null,
  revokedAt: invite.revokedAt || null,
  revokedBy: invite.revokedBy || null,
  delivery: invite.delivery || { mode: 'manual', status: 'not_sent' },
  redactedAt: invite.redactedAt || null,
  createdAt: invite.createdAt,
  updatedAt: invite.updatedAt
  };
};

const inviteRetentionConfig = (environment = process.env) => ({
  days: clampInteger(environment.SNEUP_INVITE_RETENTION_DAYS, DEFAULT_INVITE_RETENTION_DAYS, MIN_INVITE_RETENTION_DAYS, MAX_INVITE_RETENTION_DAYS),
  batchSize: clampInteger(environment.SNEUP_INVITE_RETENTION_BATCH_SIZE, DEFAULT_INVITE_RETENTION_BATCH_SIZE, 1, MAX_INVITE_RETENTION_BATCH_SIZE)
});

const retentionCutoff = ({ now = new Date(), days = DEFAULT_INVITE_RETENTION_DAYS } = {}) => {
  const current = new Date(now);
  if (Number.isNaN(current.getTime())) throw invitationError('Retention time must be a valid date');
  return new Date(current.getTime() - days * 24 * 60 * 60 * 1000);
};

const retentionQuery = ({ workspaceId, cutoff }) => ({
  ...(workspaceId ? { workspaceId } : {}),
  status: { $in: TERMINAL_INVITE_STATUSES },
  redactedAt: { $exists: false },
  updatedAt: { $lte: cutoff }
});

const publicAcceptedInvite = (invite, workspace, user, session, rawSessionToken) => ({
  invite: publicInvite(invite),
  workspace: {
    id: String(workspace._id),
    name: workspace.name,
    slug: workspace.slug
  },
  user: {
    id: String(user._id),
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    status: user.status
  },
  session: {
    id: String(session._id),
    name: session.name,
    expiresAt: session.expiresAt
  },
  sessionToken: rawSessionToken,
  authorizationHeader: `Bearer ${rawSessionToken}`
});

const isLocalHost = (host) => {
  const normalized = String(host || '').toLowerCase();
  return normalized === 'localhost' || normalized === '::1' || normalized === '[::1]'
    || normalized.startsWith('127.');
};

const getInviteUrl = (rawToken, { environment = process.env, publicUrl } = {}) => {
  const configuredUrl = publicUrl === undefined ? environment.SNEUP_PUBLIC_URL : publicUrl;
  if (!configuredUrl && isProduction(environment)) {
    throw invitationError('SNEUP_PUBLIC_URL must be an HTTPS URL before production invitations can be issued', 503);
  }

  let url;
  try {
    url = new URL(configuredUrl || 'http://localhost:3000');
  } catch (error) {
    throw invitationError('SNEUP_PUBLIC_URL must be an absolute HTTP(S) URL before invitations can be issued', 503);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw invitationError('SNEUP_PUBLIC_URL must use HTTP or HTTPS before invitations can be issued', 503);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw invitationError('SNEUP_PUBLIC_URL must not include credentials, query parameters, or a fragment before invitations can be issued', 503);
  }
  if (isProduction(environment) && (url.protocol !== 'https:' || isLocalHost(url.hostname))) {
    throw invitationError('Production SNEUP_PUBLIC_URL must use a non-local HTTPS origin before invitations can be issued', 503);
  }

  url.searchParams.set('invite', rawToken);
  return url.toString();
};

const sendInviteEmail = async ({ invite, inviteUrl }, { fetchFn = fetch, environment = process.env } = {}) => {
  assertEmailDeliveryConfigured(environment);
  const apiKey = environment.RESEND_API_KEY;
  const from = environment.SNEUP_INVITE_FROM;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAX_EMAIL_DELIVERY_TIMEOUT_MS);
  try {
    const response = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [invite.email],
        subject: `Join ${environment.SNEUP_INVITE_PRODUCT_NAME || 'Sneup'}`,
        text: `${invite.displayName}, you have been invited to join Sneup. Accept your invitation: ${inviteUrl}`
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const error = invitationError(`Invitation email provider rejected the request (${response.status})`, 502);
      error.deliveryCode = `http_${response.status}`;
      throw error;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = invitationError('Invitation email delivery timed out', 504);
      timeoutError.deliveryCode = 'timeout';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const recordAudit = async (payload) => {
  try {
    await operationsLedgerService.recordAudit(payload);
  } catch (error) {
    logger.error('Failed to record workspace invitation audit event:', error);
  }
};

const createInvite = async ({ workspace, actor, email, displayName, role, expiresInDays, deliveryMode = 'manual', reissuedFromInviteId = null }) => {
  const input = validateInviteInput({ email, displayName, role });
  if (!['manual', 'email'].includes(deliveryMode)) {
    throw invitationError('deliveryMode must be manual or email');
  }

  const existingUser = await User.findOne({ workspaceId: workspace._id, email: input.email });
  if (existingUser?.status === 'active') {
    throw invitationError('An active user already has this email in the workspace', 409);
  }
  if (existingUser?.status === 'disabled') {
    throw invitationError('A disabled user already has this email. Reactivate that user before issuing an invitation.', 409);
  }

  const user = existingUser || await User.create({
    workspaceId: workspace._id,
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    status: 'invited',
    provider: 'local'
  });

  if (existingUser) {
    user.displayName = input.displayName;
    user.role = input.role;
    await user.save();
  }

  const now = new Date();
  const revoked = await WorkspaceInvite.updateMany({
    workspaceId: workspace._id,
    userId: user._id,
    status: 'pending'
  }, {
    $set: {
      status: 'revoked',
      revokedAt: now,
      revokedBy: actor || 'sneup'
    }
  });

  const rawToken = WorkspaceInvite.generateRawToken();
  const expiresAt = new Date(now.getTime() + clampInteger(expiresInDays, 7, 1, 30) * 24 * 60 * 60 * 1000);
  const invite = await WorkspaceInvite.create(WorkspaceInvite.buildSecretRecord(rawToken, {
    workspaceId: workspace._id,
    userId: user._id,
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    expiresAt,
    createdBy: actor || 'sneup',
    delivery: {
      mode: deliveryMode,
      status: 'not_sent'
    }
  }));
  const inviteUrl = getInviteUrl(rawToken);

  const delivery = { mode: deliveryMode, status: 'not_sent' };
  if (deliveryMode === 'email') {
    invite.delivery.attemptedAt = new Date();
    try {
      await sendInviteEmail({ invite, inviteUrl });
      invite.delivery.status = 'sent';
      invite.delivery.sentAt = new Date();
      delivery.status = 'sent';
    } catch (error) {
      invite.delivery.status = 'failed';
      invite.delivery.failureCode = error.deliveryCode || 'delivery_failed';
      delivery.status = 'failed';
      delivery.message = error.message;
    }
    await invite.save();
  }

  await recordAudit({
    workspaceId: workspace._id,
    entityType: 'workspace_invite',
    entityId: invite._id,
    action: 'workspace_invite_created',
    actor: actor || 'sneup',
    source: 'api',
    riskLevel: 'high',
    afterState: {
      invite: publicInvite(invite),
      revokedPendingInvites: revoked.modifiedCount || 0,
      delivery,
      ...(reissuedFromInviteId ? { reissuedFromInviteId: String(reissuedFromInviteId) } : {})
    }
  });

  return {
    invite: publicInvite(invite),
    inviteUrl,
    delivery,
    user
  };
};

const retryInviteDelivery = async ({ workspaceId, inviteId, actor }) => {
  const invite = await WorkspaceInvite.findOne({ _id: inviteId, workspaceId });
  if (!invite) throw invitationError('Invitation not found', 404);
  const expiresAt = new Date(invite.expiresAt);
  if (invite.status !== 'pending' || expiresAt <= new Date() || invite.delivery?.mode !== 'email' || !['failed', 'not_sent'].includes(invite.delivery?.status)) {
    throw invitationError('Only pending, unexpired email invitations with an unsent delivery can be retried', 409);
  }

  const user = await User.findOne({
    _id: invite.userId,
    workspaceId,
    status: 'invited'
  });
  if (!user) {
    throw invitationError('The invited user is no longer eligible for a delivery retry', 409);
  }

  assertEmailDeliveryConfigured();
  getInviteUrl('sneup_invite_delivery_preflight');

  const beforeState = publicInvite(invite);
  const retryActor = actor || 'sneup';
  const revoked = await WorkspaceInvite.findOneAndUpdate({
    _id: inviteId,
    workspaceId,
    status: 'pending',
    'delivery.mode': 'email',
    'delivery.status': { $in: ['failed', 'not_sent'] }
  }, {
    $set: {
      status: 'revoked',
      revokedAt: new Date(),
      revokedBy: `${retryActor}:delivery_retry`
    }
  }, { new: true });
  if (!revoked) {
    throw invitationError('Invitation delivery was already retried, revoked, or accepted', 409);
  }

  let result;
  try {
    result = await createInvite({
      workspace: { _id: workspaceId },
      actor: retryActor,
      email: invite.email,
      displayName: invite.displayName,
      role: invite.role,
      expiresInDays: Math.max(1, Math.ceil((new Date(invite.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))),
      deliveryMode: 'email',
      reissuedFromInviteId: invite._id
    });
  } catch (error) {
    await WorkspaceInvite.findOneAndUpdate({
      _id: revoked._id,
      workspaceId,
      status: 'revoked',
      revokedBy: `${retryActor}:delivery_retry`
    }, {
      $set: { status: 'pending' },
      $unset: { revokedAt: 1, revokedBy: 1 }
    });
    throw error;
  }

  await recordAudit({
    workspaceId,
    entityType: 'workspace_invite',
    entityId: revoked._id,
    action: 'workspace_invite_delivery_reissued',
    actor: retryActor,
    source: 'api',
    riskLevel: 'high',
    beforeState,
    afterState: {
      revokedInvite: publicInvite(revoked),
      replacementInvite: result.invite,
      delivery: result.delivery
    }
  });

  return {
    ...result,
    replacedInviteId: String(revoked._id)
  };
};

const listInvites = async ({ workspaceId, limit }) => {
  const now = new Date();
  await WorkspaceInvite.updateMany({
    workspaceId,
    status: 'pending',
    expiresAt: { $lte: now }
  }, { $set: { status: 'expired' } });

  return WorkspaceInvite.find({ workspaceId })
    .sort({ status: 1, createdAt: -1 })
    .limit(clampInteger(limit, 100, 1, 500));
};

const listRetainableWorkspaceIds = async ({ now = new Date(), environment = process.env } = {}) => {
  const config = inviteRetentionConfig(environment);
  const cutoff = retentionCutoff({ now, days: config.days });
  return WorkspaceInvite.distinct('workspaceId', retentionQuery({ cutoff }));
};

const redactRetainedInvites = async ({ workspaceId, now = new Date(), environment = process.env, actor = 'sneup-invite-retention' } = {}) => {
  if (!workspaceId) throw invitationError('workspaceId is required for invitation retention', 400);
  const config = inviteRetentionConfig(environment);
  const cutoff = retentionCutoff({ now, days: config.days });
  const candidates = await WorkspaceInvite.find(retentionQuery({ workspaceId, cutoff }))
    .select('_id status acceptedAt revokedAt expiresAt delivery.mode delivery.status createdAt updatedAt')
    .sort({ updatedAt: 1 })
    .limit(config.batchSize);
  if (candidates.length === 0) {
    return { processedCount: 0, successCount: 0, failureCount: 0, metadata: { retentionDays: config.days, cutoff, batchSize: config.batchSize } };
  }

  const candidateIds = candidates.map(invite => invite._id);
  const result = await WorkspaceInvite.updateMany({
    _id: { $in: candidateIds },
    ...retentionQuery({ workspaceId, cutoff })
  }, {
    $set: { redactedAt: new Date(now), redactedBy: actor },
    $unset: { email: 1, displayName: 1, tokenPrefix: 1, tokenHash: 1, 'delivery.failureCode': 1 }
  });
  const redactedCount = Number(result.modifiedCount ?? result.nModified ?? 0);
  if (redactedCount > 0) {
    const byStatus = candidates.reduce((summary, invite) => {
      summary[invite.status] = (summary[invite.status] || 0) + 1;
      return summary;
    }, {});
    await recordAudit({
      workspaceId,
      entityType: 'workspace_invite_retention',
      entityId: String(workspaceId),
      action: 'workspace_invites_redacted',
      actor,
      source: 'scheduled',
      riskLevel: 'medium',
      afterState: { redactedCount, retentionDays: config.days, cutoff, byStatus }
    });
  }
  return {
    processedCount: candidates.length,
    successCount: redactedCount,
    failureCount: 0,
    metadata: { retentionDays: config.days, cutoff, batchSize: config.batchSize, redactedCount }
  };
};

const revokeInvite = async ({ workspaceId, inviteId, actor }) => {
  const invite = await WorkspaceInvite.findOne({ _id: inviteId, workspaceId });
  if (!invite) throw invitationError('Invitation not found', 404);
  if (invite.status !== 'pending') {
    throw invitationError('Only pending invitations can be revoked', 409);
  }

  const beforeState = publicInvite(invite);
  await invite.revoke(actor || 'sneup');
  await recordAudit({
    workspaceId,
    entityType: 'workspace_invite',
    entityId: invite._id,
    action: 'workspace_invite_revoked',
    actor: actor || 'sneup',
    source: 'api',
    riskLevel: 'high',
    beforeState,
    afterState: publicInvite(invite)
  });
  return invite;
};

const acceptInvite = async ({ rawToken, displayName }) => {
  const token = String(rawToken || '').trim();
  if (!token.startsWith('sneup_invite_')) {
    throw invitationError('Invitation is invalid or has expired');
  }

  const invite = await WorkspaceInvite.findOne({
    tokenPrefix: WorkspaceInvite.prefixFor(token),
    status: 'pending'
  }).select('+tokenHash');
  if (!invite || !invite.matches(token)) {
    throw invitationError('Invitation is invalid or has expired');
  }

  const now = new Date();
  if (!invite.isUsable(now)) {
    if (invite.status === 'pending' && invite.expiresAt <= now) {
      invite.status = 'expired';
      await invite.save();
    }
    throw invitationError('Invitation is invalid or has expired');
  }

  const user = await User.findOne({
    _id: invite.userId,
    workspaceId: invite.workspaceId,
    status: 'invited'
  });
  if (!user) {
    throw invitationError('Invitation is invalid or has expired');
  }

  const rawSessionToken = SessionToken.generateRawToken();
  const session = await SessionToken.create(SessionToken.buildSecretRecord(rawSessionToken, {
    workspaceId: invite.workspaceId,
    userId: user._id,
    name: 'Invitation onboarding session',
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    createdBy: `invite:${String(invite._id)}`,
    metadata: { inviteId: String(invite._id), onboarding: true }
  }));

  const accepted = await WorkspaceInvite.findOneAndUpdate({
    _id: invite._id,
    status: 'pending',
    expiresAt: { $gt: now }
  }, {
    $set: {
      status: 'accepted',
      acceptedAt: now
    }
  }, { new: true });

  if (!accepted) {
    await session.revoke('invite_acceptance_race');
    throw invitationError('Invitation is invalid or has expired');
  }

  user.status = 'active';
  user.lastSeenAt = now;
  if (String(displayName || '').trim()) user.displayName = String(displayName).trim();
  await user.save();

  const Workspace = require('../models/Workspace');
  const workspace = await Workspace.findById(invite.workspaceId);
  if (!workspace) {
    await session.revoke('workspace_missing');
    throw invitationError('Invitation workspace is unavailable', 503);
  }

  await recordAudit({
    workspaceId: invite.workspaceId,
    entityType: 'workspace_invite',
    entityId: accepted._id,
    action: 'workspace_invite_accepted',
    actor: String(user._id),
    source: 'invite_acceptance',
    riskLevel: 'high',
    afterState: {
      invite: publicInvite(accepted),
      user: { id: String(user._id), role: user.role, status: user.status },
      session: { id: String(session._id), expiresAt: session.expiresAt }
    }
  });

  return publicAcceptedInvite(accepted, workspace, user, session, rawSessionToken);
};

module.exports = {
  USER_ROLES,
  acceptInvite,
  createInvite,
  getInviteUrl,
  inviteRetentionConfig,
  listInvites,
  listRetainableWorkspaceIds,
  publicInvite,
  redactRetainedInvites,
  retentionCutoff,
  retryInviteDelivery,
  revokeInvite,
  sendInviteEmail,
  validateInviteInput
};
