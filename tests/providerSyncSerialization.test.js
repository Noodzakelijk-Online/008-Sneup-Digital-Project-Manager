const { ProviderSyncPolicyService } = require('../src/services/providerSyncPolicyService');

const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for provider queue');
};

describe('provider sync serialization', () => {
  test('serializes complete sync callbacks for the same provider and releases the queue afterward', async () => {
    const policy = new ProviderSyncPolicyService({ sleep: jest.fn() });
    const starts = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const first = policy.run('github', async () => {
      starts.push('first');
      await gate;
      return 'first-result';
    }, { minIntervalMs: 0 });
    const second = policy.run('github', async () => {
      starts.push('second');
      return 'second-result';
    }, { minIntervalMs: 0 });

    await waitFor(() => starts.length === 1);
    expect(starts).toEqual(['first']);

    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ result: 'first-result' }),
      expect.objectContaining({ result: 'second-result' })
    ]);
    expect(starts).toEqual(['first', 'second']);
    expect(policy.providerQueues.size).toBe(0);
  });

  test('permits independent providers to run without sharing a queue', async () => {
    const policy = new ProviderSyncPolicyService({ sleep: jest.fn() });
    const starts = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const github = policy.run('github', async () => {
      starts.push('github');
      await gate;
      return 'github-result';
    }, { minIntervalMs: 0 });
    const asana = policy.run('asana', async () => {
      starts.push('asana');
      await gate;
      return 'asana-result';
    }, { minIntervalMs: 0 });

    await waitFor(() => starts.length === 2);
    expect([...starts].sort()).toEqual(['asana', 'github']);

    release();
    await expect(Promise.all([github, asana])).resolves.toHaveLength(2);
  });
});
