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

  const loadService = ({ invite, user, replacementInvite, retentionCandidates = [], retentionModifiedCount = 0, retainableWorkspaceIds = [] }) => {
    const retentionChain = {
      select: jest.fn(),
      sort: jest.fn(),
      limit: jest.fn().mockResolvedValue(retentionCandidates)
    };
    retentionChain.select.mockReturnValue(retentionChain);
    retentionChain.sort.mockReturnValue(retentionChain);
    const WorkspaceInvite = {
      findOne: jest.fn().mockResolvedValue(invite),
      findOneAndUpdate: jest.fn().mockResolvedValue({
        ...invite,
        status: 'revoked',
        revokedAt: new Date('2026-07-14T12:00:00.000Z'),
        revokedBy: 'admin-1:delivery_retry'
      }),
      find: jest.fn(() => retentionChain),
      distinct: jest.fn().mockResolvedValue(retainableWorkspaceIds),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: retentionModifiedCount }),
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

  test('redacts terminal invitation personal data in bounded batches and records aggregate-only audit evidence', async () => {
    const candidate = {
      _id: 'invite-retain-1',
      workspaceId: 'workspace-1',
      status: 'accepted',
      acceptedAt: new Date('2026-03-01T10:00:00.000Z'),
      expiresAt: new Date('2026-03-08T10:00:00.000Z'),
      delivery: { mode: 'email', status: 'sent' },
      updatedAt: new Date('2026-03-01T10:00:00.000Z')
    };
    const { service, WorkspaceInvite, operationsLedgerService } = loadService({
      invite: candidate,
      user: { _id: 'user-1', status: 'active' },
      replacementInvite: { save: jest.fn() },
      retentionCandidates: [candidate],
      retentionModifiedCount: 1,
      retainableWorkspaceIds: ['workspace-1']
    });
    const now = new Date('2026-07-14T12:00:00.000Z');
    const environment = {
      SNEUP_INVITE_RETENTION_DAYS: '30',
      SNEUP_INVITE_RETENTION_BATCH_SIZE: '10'
    };

    const workspaceIds = await service.listRetainableWorkspaceIds({ now, environment });
    const result = await service.redactRetainedInvites({ workspaceId: 'workspace-1', now, environment });
    const publicRecord = service.publicInvite({
      ...candidate,
      email: 'private.invitee@example.com',
      displayName: 'Private Invitee',
      tokenPrefix: 'sneup_invite_private',
      redactedAt: now
    });

    expect(workspaceIds).toEqual(['workspace-1']);
    expect(WorkspaceInvite.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      _id: { $in: ['invite-retain-1'] },
      workspaceId: 'workspace-1',
      status: { $in: ['accepted', 'revoked', 'expired'] },
      redactedAt: { $exists: false }
    }), {
      $set: expect.objectContaining({ redactedBy: 'sneup-invite-retention' }),
      $unset: expect.objectContaining({ email: 1, displayName: 1, tokenPrefix: 1, tokenHash: 1 })
    });
    expect(result).toMatchObject({ processedCount: 1, successCount: 1, metadata: { retentionDays: 30, redactedCount: 1 } });
    expect(publicRecord).toMatchObject({ email: '', displayName: '', tokenPrefix: '', redactedAt: now });
    expect(service.inviteRetentionConfig({ SNEUP_INVITE_RETENTION_DAYS: '1', SNEUP_INVITE_RETENTION_BATCH_SIZE: '1000' }))
      .toEqual({ days: 7, batchSize: 250 });
    expect(operationsLedgerService.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'workspace_invites_redacted',
      source: 'scheduled',
      afterState: expect.objectContaining({ redactedCount: 1, retentionDays: 30, byStatus: { accepted: 1 } })
    }));
    expect(JSON.stringify(operationsLedgerService.recordAudit.mock.calls)).not.toMatch(/new\.user@example\.com|tokenHash|displayName/);
  });
});
