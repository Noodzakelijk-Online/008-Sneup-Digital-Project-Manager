describe('workspace invitation delivery retries', () => {
  const originalEnvironment = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    SNEUP_INVITE_FROM: process.env.SNEUP_INVITE_FROM,
    SNEUP_PUBLIC_URL: process.env.SNEUP_PUBLIC_URL
  };
  const originalFetch = global.fetch;

  const restoreEnvironment = () => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    global.fetch = originalFetch;
  };

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    restoreEnvironment();
  });

  const loadService = ({ invite, user, replacementInvite }) => {
    const WorkspaceInvite = {
      findOne: jest.fn().mockResolvedValue(invite),
      findOneAndUpdate: jest.fn().mockResolvedValue({
        ...invite,
        status: 'revoked',
        revokedAt: new Date('2026-07-14T12:00:00.000Z'),
        revokedBy: 'admin-1:delivery_retry'
      }),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      generateRawToken: jest.fn(() => 'sneup_invite_fresh_token'),
      prefixFor: jest.fn(token => String(token).slice(0, 18)),
      buildSecretRecord: jest.fn((token, fields) => ({
        ...fields,
        tokenPrefix: String(token).slice(0, 18),
        tokenHash: 'fresh-hash'
      })),
      create: jest.fn().mockResolvedValue(replacementInvite)
    };
    const User = { findOne: jest.fn().mockResolvedValue(user) };
    const operationsLedgerService = { recordAudit: jest.fn().mockResolvedValue(null) };

    jest.doMock('../src/models/WorkspaceInvite', () => WorkspaceInvite);
    jest.doMock('../src/models/User', () => User);
    jest.doMock('../src/models/SessionToken', () => ({}));
    jest.doMock('../src/services/operationsLedgerService', () => operationsLedgerService);
    jest.doMock('../src/utils/logger', () => ({ error: jest.fn() }));

    return {
      service: require('../src/services/workspaceInviteService'),
      WorkspaceInvite,
      User,
      operationsLedgerService
    };
  };

  test('reissues a failed email invitation with a fresh token and audit evidence', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.SNEUP_INVITE_FROM = 'Sneup <invites@example.com>';
    process.env.SNEUP_PUBLIC_URL = 'https://sneup.example.com';
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    const invite = {
      _id: 'invite-old',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      email: 'new.user@example.com',
      displayName: 'New User',
      role: 'viewer',
      tokenPrefix: 'sneup_invite_old',
      status: 'pending',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      createdBy: 'admin-1',
      delivery: { mode: 'email', status: 'failed', failureCode: 'timeout' }
    };
    const replacementInvite = {
      _id: 'invite-new',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      email: 'new.user@example.com',
      displayName: 'New User',
      role: 'viewer',
      tokenPrefix: 'sneup_invite_fresh',
      status: 'pending',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      createdBy: 'admin-1',
      delivery: { mode: 'email', status: 'not_sent' },
      save: jest.fn().mockResolvedValue(null)
    };
    const user = { _id: 'user-1', workspaceId: 'workspace-1', status: 'invited', save: jest.fn() };
    const { service, WorkspaceInvite, operationsLedgerService } = loadService({ invite, user, replacementInvite });

    const result = await service.retryInviteDelivery({
      workspaceId: 'workspace-1',
      inviteId: 'invite-old',
      actor: 'admin-1'
    });

    expect(WorkspaceInvite.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({
      _id: 'invite-old',
      workspaceId: 'workspace-1',
      status: 'pending',
      'delivery.mode': 'email',
      'delivery.status': { $in: ['failed', 'not_sent'] }
    }), expect.any(Object), { new: true });
    expect(WorkspaceInvite.create).toHaveBeenCalledWith(expect.objectContaining({
      tokenPrefix: 'sneup_invite_fresh',
      tokenHash: 'fresh-hash',
      delivery: { mode: 'email', status: 'not_sent' }
    }));
    expect(global.fetch).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
      method: 'POST',
      redirect: 'error'
    }));
    expect(replacementInvite.delivery.status).toBe('sent');
    expect(replacementInvite.save).toHaveBeenCalledTimes(1);
    expect(result.replacedInviteId).toBe('invite-old');
    expect(result.invite.id).toBe('invite-new');
    expect(result.inviteUrl).toContain('sneup_invite_fresh_token');
    expect(operationsLedgerService.recordAudit).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'workspace_invite_delivery_reissued',
      entityId: 'invite-old',
      beforeState: expect.objectContaining({ id: 'invite-old', status: 'pending' }),
      afterState: expect.objectContaining({
        replacementInvite: expect.objectContaining({ id: 'invite-new' }),
        delivery: expect.objectContaining({ status: 'sent' })
      })
    }));
  });

  test('does not retry manual, sent, expired, or non-pending invitations', async () => {
    const invite = {
      _id: 'invite-manual',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      email: 'new.user@example.com',
      displayName: 'New User',
      role: 'viewer',
      status: 'pending',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      delivery: { mode: 'manual', status: 'not_sent' }
    };
    const replacementInvite = { save: jest.fn() };
    const { service, WorkspaceInvite } = loadService({
      invite,
      user: { _id: 'user-1', status: 'invited' },
      replacementInvite
    });

    await expect(service.retryInviteDelivery({
      workspaceId: 'workspace-1',
      inviteId: 'invite-manual',
      actor: 'admin-1'
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(WorkspaceInvite.findOneAndUpdate).not.toHaveBeenCalled();

    invite.delivery = { mode: 'email', status: 'failed' };
    invite.expiresAt = new Date(Date.now() - 1000);
    await expect(service.retryInviteDelivery({
      workspaceId: 'workspace-1',
      inviteId: 'invite-manual',
      actor: 'admin-1'
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(WorkspaceInvite.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('restores the prior invitation when a replacement cannot be created', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.SNEUP_INVITE_FROM = 'Sneup <invites@example.com>';
    process.env.SNEUP_PUBLIC_URL = 'https://sneup.example.com';
    const invite = {
      _id: 'invite-old',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      email: 'new.user@example.com',
      displayName: 'New User',
      role: 'viewer',
      tokenPrefix: 'sneup_invite_old',
      status: 'pending',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      delivery: { mode: 'email', status: 'failed' }
    };
    const { service, WorkspaceInvite } = loadService({
      invite,
      user: { _id: 'user-1', workspaceId: 'workspace-1', status: 'invited', save: jest.fn().mockResolvedValue(null) },
      replacementInvite: { save: jest.fn() }
    });
    WorkspaceInvite.create.mockRejectedValue(new Error('database unavailable'));

    await expect(service.retryInviteDelivery({
      workspaceId: 'workspace-1',
      inviteId: 'invite-old',
      actor: 'admin-1'
    })).rejects.toThrow('database unavailable');

    expect(WorkspaceInvite.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(WorkspaceInvite.findOneAndUpdate.mock.calls[1]).toEqual([
      expect.objectContaining({
        _id: 'invite-old',
        workspaceId: 'workspace-1',
        status: 'revoked',
        revokedBy: 'admin-1:delivery_retry'
      }),
      {
        $set: { status: 'pending' },
        $unset: { revokedAt: 1, revokedBy: 1 }
      }
    ]);
  });
});
