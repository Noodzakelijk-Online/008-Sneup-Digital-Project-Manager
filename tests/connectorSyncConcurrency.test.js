const ConnectorAccount = require('../src/models/ConnectorAccount');
const { ConnectorSyncService } = require('../src/services/connectorSyncService');

const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for connector sync workers');
};

describe('connector sync concurrency', () => {
  afterEach(() => jest.restoreAllMocks());

  test('runs different provider queues concurrently while keeping each provider serial', async () => {
    const accounts = [
      { _id: 'a1', connectorId: 'github' },
      { _id: 'a2', connectorId: 'github' },
      { _id: 'a3', connectorId: 'asana' },
      { _id: 'a4', connectorId: 'asana' }
    ];
    jest.spyOn(ConnectorAccount, 'find').mockReturnValue({ sort: jest.fn().mockResolvedValue(accounts) });
    const service = new ConnectorSyncService();
    service.requireDatabase = jest.fn();
    service.finalizeDependencyFreshness = jest.fn().mockResolvedValue({ providerCount: 2, markedStale: 0, failureCount: 0, byProvider: {} });
    const activeByProvider = new Map();
    const starts = [];
    let maxTotal = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    service.syncAccount = jest.fn(async account => {
      const provider = account.connectorId;
      const active = (activeByProvider.get(provider) || 0) + 1;
      activeByProvider.set(provider, active);
      maxTotal = Math.max(maxTotal, [...activeByProvider.values()].reduce((sum, value) => sum + value, 0));
      starts.push(`${provider}:${account._id}`);
      await gate;
      activeByProvider.set(provider, (activeByProvider.get(provider) || 1) - 1);
      return { connectorId: provider, signalCount: 1, retryCount: 0, rateLimitWaitMs: 0 };
    });

    const workspaceId = '507f1f77bcf86cd799439011';
    const sync = service.syncConnectedAccounts({ workspaceId, concurrency: 2 });
    await waitFor(() => starts.length === 2);
    expect([...starts].sort()).toEqual(['asana:a3', 'github:a1']);
    expect(maxTotal).toBe(2);
    expect([...activeByProvider.values()]).toEqual(expect.arrayContaining([1, 1]));
    release();

    await expect(sync).resolves.toMatchObject({
      processedCount: 4,
      successCount: 4,
      failureCount: 0,
      metadata: { signalCount: 4, concurrency: 2, providerQueueCount: 2 }
    });
    expect(service.syncAccount.mock.calls.map(([account]) => `${account.connectorId}:${account._id}`)).toEqual([
      'github:a1', 'asana:a3', 'github:a2', 'asana:a4'
    ]);
    const [freshnessWorkspaceId, freshnessProviders] = service.finalizeDependencyFreshness.mock.calls[0];
    expect(String(freshnessWorkspaceId)).toBe(workspaceId);
    expect(freshnessProviders).toEqual(new Set(['github', 'asana']));
  });

  test('clamps configured provider queue concurrency to a safe range', () => {
    const service = new ConnectorSyncService();
    expect(service.getAccountSyncConcurrency('0')).toBe(1);
    expect(service.getAccountSyncConcurrency('99')).toBe(8);
    expect(service.getAccountSyncConcurrency('invalid')).toBe(3);
  });
});
