const WorkSignal = require('../src/models/WorkSignal');
const workGraphService = require('../src/services/workGraphService');
const { WorkSignalService } = require('../src/services/workSignalService');

describe('work-signal batch upsert', () => {
  afterEach(() => jest.restoreAllMocks());

  test('reuses the authenticated account, batches signal writes, and saves it once for a provider batch', async () => {
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
    jest.spyOn(WorkSignal, 'bulkWrite').mockResolvedValue({});
    jest.spyOn(WorkSignal, 'find').mockImplementation((query) => ({
      lean: jest.fn().mockResolvedValue(query.externalId.$in.map(externalId => ({
        _id: `signal-${externalId}`,
        workspaceId,
        connectorAccountId: account._id,
        provider: account.connectorId,
        externalId,
        title: externalId === 'one' ? 'One' : 'Two',
        sourceType: 'issue',
        status: 'open',
        priority: 'normal',
        description: '',
        owners: [],
        labels: [],
        evidenceRefs: [],
        raw: { id: externalId },
        firstSeenAt: new Date(),
        lastSeenAt: new Date()
      })))
    }));
    jest.spyOn(workGraphService, 'upsertFromSignal').mockResolvedValue(undefined);

    await expect(service.upsertProviderRecords(account, [
      { id: 'one', title: 'One' },
      { id: 'two', title: 'Two' }
    ], { workspaceId, actorId: 'connector-sync', deferDependencyFreshness: true })).resolves.toMatchObject({
      count: 2,
      lastSignal: { externalId: 'two' },
      batchCount: 1,
      batchSize: 100
    });

    expect(account.save).toHaveBeenCalledTimes(1);
    expect(WorkSignal.bulkWrite).toHaveBeenCalledTimes(1);
    expect(WorkSignal.bulkWrite.mock.calls[0][0]).toHaveLength(2);
    expect(WorkSignal.find).toHaveBeenCalledTimes(1);
    expect(workGraphService.upsertFromSignal).toHaveBeenCalledTimes(2);
    expect(workGraphService.upsertFromSignal.mock.calls.every(([, options]) => options.deferDependencyFreshness === true)).toBe(true);
  });

  test('caps database batches while preserving graph projection order', async () => {
    const workspaceId = '507f1f77bcf86cd799439011';
    const account = { _id: 'account-1', workspaceId, connectorId: 'github', save: jest.fn().mockResolvedValue(undefined) };
    const service = new WorkSignalService();
    service.requireDatabase = jest.fn();
    service.resolveWorkspaceId = jest.fn(() => workspaceId);
    service.normalizeSignalPayload = jest.fn((_account, payload) => ({ workspaceId, externalId: payload.externalId, title: payload.title, sourceType: 'issue', status: 'open', priority: 'normal', description: '', owners: [], labels: [], evidenceRefs: [], raw: {} }));
    const adapter = require('../src/services/workSignalAdapterService');
    jest.spyOn(adapter, 'normalize').mockImplementation((_account, record) => ({ externalId: record.id, title: record.title }));
    jest.spyOn(WorkSignal, 'bulkWrite').mockResolvedValue({});
    jest.spyOn(WorkSignal, 'find').mockImplementation((query) => ({ lean: jest.fn().mockResolvedValue(query.externalId.$in.map(externalId => ({ _id: `signal-${externalId}`, workspaceId, connectorAccountId: account._id, provider: account.connectorId, externalId, title: externalId, sourceType: 'issue', status: 'open', priority: 'normal', description: '', owners: [], labels: [], evidenceRefs: [], raw: {} }))) }));
    jest.spyOn(workGraphService, 'upsertFromSignal').mockResolvedValue(undefined);

    const records = Array.from({ length: 11 }, (_, index) => ({ id: `item-${index + 1}`, title: `Item ${index + 1}` }));
    await expect(service.upsertProviderRecords(account, records, { workspaceId, batchSize: 2 })).resolves.toMatchObject({
      count: 11,
      batchCount: 2,
      batchSize: 10
    });

    expect(WorkSignal.bulkWrite.mock.calls.map(([operations]) => operations.length)).toEqual([10, 1]);
    expect(workGraphService.upsertFromSignal.mock.calls.map(([signal]) => signal.externalId)).toEqual(records.map(record => record.id));
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

    await expect(service.upsertProviderRecords(account, [], { workspaceId: 'workspace-1', deferAccountSave: true })).resolves.toMatchObject({
      count: 0,
      lastSignal: null,
      batchCount: 0,
      batchSize: 100
    });
    expect(account.save).not.toHaveBeenCalled();
  });
});
