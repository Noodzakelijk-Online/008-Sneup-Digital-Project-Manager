const WorkSignal = require('../src/models/WorkSignal');
const workGraphService = require('../src/services/workGraphService');
const { WorkSignalService } = require('../src/services/workSignalService');

describe('work-signal batch upsert', () => {
  afterEach(() => jest.restoreAllMocks());

  test('reuses the authenticated account and saves it once for a provider batch', async () => {
    const workspaceId = '507f1f77bcf86cd799439011';
    const account = { _id: 'account-1', workspaceId, connectorId: 'github', save: jest.fn().mockResolvedValue(undefined) };
    const service = new WorkSignalService();
    service.requireDatabase = jest.fn();
    service.resolveWorkspaceId = jest.fn(() => workspaceId);
    service.normalizeSignalPayload = jest.fn((_account, payload) => ({
      workspaceId,
      externalId: payload.externalId,
      title: payload.title,
      sourceType: 'issue',
      status: 'open',
      priority: 'normal',
      description: '',
      owners: [],
      labels: [],
      evidenceRefs: [],
      raw: { id: payload.externalId }
    }));
    const adapter = require('../src/services/workSignalAdapterService');
    jest.spyOn(adapter, 'normalize').mockImplementation((_account, record) => ({ externalId: record.id, title: record.title }));
    jest.spyOn(WorkSignal, 'findOneAndUpdate').mockImplementation(async (_query, update) => ({
      _id: `signal-${update.$set.externalId}`,
      ...update.$set,
      firstSeenAt: new Date(),
      lastSeenAt: update.$set.lastSeenAt
    }));
    jest.spyOn(workGraphService, 'upsertFromSignal').mockResolvedValue(undefined);

    await expect(service.upsertProviderRecords(account, [
      { id: 'one', title: 'One' },
      { id: 'two', title: 'Two' }
    ], { workspaceId, actorId: 'connector-sync', deferDependencyFreshness: true })).resolves.toMatchObject({ count: 2, lastSignal: { externalId: 'two' } });

    expect(account.save).toHaveBeenCalledTimes(1);
    expect(WorkSignal.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(workGraphService.upsertFromSignal).toHaveBeenCalledTimes(2);
    expect(workGraphService.upsertFromSignal.mock.calls.every(([, options]) => options.deferDependencyFreshness === true)).toBe(true);
  });

  test('fails closed before writing when records are not an array or account scope differs', async () => {
    const service = new WorkSignalService();
    service.requireDatabase = jest.fn();
    service.resolveWorkspaceId = jest.fn(() => 'workspace-1');
    const account = { _id: 'account-1', workspaceId: 'workspace-1', connectorId: 'github', save: jest.fn() };

    await expect(service.upsertProviderRecords(account, {}, { workspaceId: 'workspace-1' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.upsertProviderRecords({ ...account, workspaceId: 'other' }, [], { workspaceId: 'workspace-1' })).rejects.toMatchObject({ statusCode: 404 });
    expect(account.save).not.toHaveBeenCalled();
  });

  test('can defer account persistence so the scheduler saves cursor and health metadata once', async () => {
    const service = new WorkSignalService();
    service.requireDatabase = jest.fn();
    service.resolveWorkspaceId = jest.fn(() => 'workspace-1');
    const account = { _id: 'account-1', workspaceId: 'workspace-1', connectorId: 'github', save: jest.fn() };

    await expect(service.upsertProviderRecords(account, [], { workspaceId: 'workspace-1', deferAccountSave: true })).resolves.toMatchObject({ count: 0, lastSignal: null });
    expect(account.save).not.toHaveBeenCalled();
  });
});
