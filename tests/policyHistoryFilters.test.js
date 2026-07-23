describe('policy history filters', () => {
  afterEach(() => {
    jest.dontMock('mongoose');
    jest.dontMock('../src/models/AuditEvent');
    jest.dontMock('../src/services/workspaceScopeService');
    jest.resetModules();
  });

  test('limits history to the requested workspace, policy action, actor, and time window', async () => {
    jest.resetModules();
    const chain = {
      sort: jest.fn(() => chain),
      limit: jest.fn().mockResolvedValue([])
    };
    const find = jest.fn(() => chain);
    jest.doMock('mongoose', () => ({ connection: { readyState: 1 } }));
    jest.doMock('../src/models/AuditEvent', () => ({ find }));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn(value => value)
    }));

    const policyRuleService = require('../src/services/policyRuleService');
    await expect(policyRuleService.listPolicyHistory({
      workspaceId: 'workspace-1',
      actionType: 'scheduled_intervention_cooldown',
      actor: 'manager-1',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-20T00:00:00.000Z',
      limit: 500
    })).resolves.toEqual([]);

    expect(find).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      entityType: 'policy_rule',
      actor: 'manager-1',
      action: expect.objectContaining({
        $in: expect.arrayContaining(['scheduled_intervention_cooldown_policy_updated'])
      }),
      $or: [
        { 'afterState.actionType': 'scheduled_intervention_cooldown' },
        { 'beforeState.actionType': 'scheduled_intervention_cooldown' }
      ],
      createdAt: {
        $gte: new Date('2026-07-01T00:00:00.000Z'),
        $lte: new Date('2026-07-20T00:00:00.000Z')
      }
    }));
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(chain.limit).toHaveBeenCalledWith(100);
  });

  test('rejects unsupported actions and invalid date ranges before querying audit data', async () => {
    jest.resetModules();
    const find = jest.fn();
    jest.doMock('mongoose', () => ({ connection: { readyState: 1 } }));
    jest.doMock('../src/models/AuditEvent', () => ({ find }));
    jest.doMock('../src/services/workspaceScopeService', () => ({
      normalizeWorkspaceObjectId: jest.fn(value => value)
    }));

    const policyRuleService = require('../src/services/policyRuleService');
    await expect(policyRuleService.listPolicyHistory({
      workspaceId: 'workspace-1',
      actionType: 'drop_database'
    })).rejects.toMatchObject({ statusCode: 400 });
    await expect(policyRuleService.listPolicyHistory({
      workspaceId: 'workspace-1',
      from: 'not-a-date'
    })).rejects.toMatchObject({ statusCode: 400 });
    await expect(policyRuleService.listPolicyHistory({
      workspaceId: 'workspace-1',
      from: '2026-07-20T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z'
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(find).not.toHaveBeenCalled();
  });

  test('indexes the bounded workspace policy-history query shape', () => {
    const AuditEvent = require('../src/models/AuditEvent');
    expect(AuditEvent.schema.indexes()).toEqual(expect.arrayContaining([
      [{ workspaceId: 1, entityType: 1, action: 1, createdAt: -1 }, expect.any(Object)]
    ]));
  });
});
