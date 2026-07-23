const workspaceScopeService = require('../src/services/workspaceScopeService');

const model = ({ missing = 0, conflicts = [] } = {}) => ({
  countDocuments: jest.fn().mockResolvedValue(missing),
  aggregate: jest.fn().mockResolvedValue(conflicts),
  updateMany: jest.fn()
});

describe('workspace migration preflight', () => {
  test('reports only aggregate future unique-key conflicts before any backfill write', async () => {
    const workspaceId = '507f1f77bcf86cd799439011';
    const boards = model({ missing: 2 });
    const policyRules = model({ conflicts: [{ duplicateGroups: 1, duplicateRecords: 2 }] });
    const jobControls = model();

    const preflight = await workspaceScopeService.inspectDefaultWorkspaceMigration({
      models: [['boards', boards]],
      workspaceId,
      workspaceKey: 'production',
      policyRuleModel: policyRules,
      jobControlModel: jobControls
    });

    expect(preflight).toMatchObject({
      mode: 'inspect',
      totalMissing: 2,
      indexPreflight: {
        canApply: false,
        duplicateGroups: 1,
        duplicateRecords: 2,
        policyRules: { duplicateGroups: 1, duplicateRecords: 2 },
        jobControls: { duplicateGroups: 0, duplicateRecords: 0 }
      }
    });
    expect(boards.updateMany).not.toHaveBeenCalled();
    expect(policyRules.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ $match: expect.objectContaining({ $or: expect.any(Array) }) }),
      expect.objectContaining({ $group: expect.objectContaining({ _id: { actionType: '$actionType' } }) })
    ]));
    expect(JSON.stringify(preflight.indexPreflight)).not.toMatch(/credential|token|condition|507f1f77/i);
    expect(() => workspaceScopeService.assertWorkspaceMigrationReady(preflight)).toThrow(/preflight found duplicate/i);
  });

  test('allows a clean preflight and treats a missing legacy collection as conflict-free', async () => {
    const namespaceMissing = model();
    namespaceMissing.aggregate.mockRejectedValue({ code: 26, codeName: 'NamespaceNotFound' });
    const preflight = await workspaceScopeService.inspectDefaultWorkspaceMigration({
      models: [],
      workspaceId: '507f1f77bcf86cd799439011',
      policyRuleModel: namespaceMissing,
      jobControlModel: model()
    });

    expect(preflight.indexPreflight).toMatchObject({ canApply: true, duplicateGroups: 0, duplicateRecords: 0 });
    expect(() => workspaceScopeService.assertWorkspaceMigrationReady(preflight)).not.toThrow();
  });
});
