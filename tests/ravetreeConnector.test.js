const { RavetreeWorkSignalClient } = require('../src/services/ravetreeWorkSignalClient');

const account = { connectorId: 'ravetree' };
const workItem = (id = '62d9b8da607a89d3aba11724', overrides = {}) => ({ id, title: 'Prepare project handoff', startsOn: '2026-07-01', dueOn: '2026-07-10', created: { at: '2026-07-01T10:00:00Z' }, updated: { at: '2026-07-02T10:00:00Z' }, ...overrides });

describe('Ravetree connector', () => {
  test('reads bounded work-item metadata through Ravetree\'s fixed API endpoint', async () => {
    const previousPageSize = process.env.SNEUP_RAVETREE_PAGE_SIZE;
    process.env.SNEUP_RAVETREE_PAGE_SIZE = '1';
    const http = { get: jest.fn()
      .mockResolvedValueOnce({ data: { data: [workItem('62d9b8da607a89d3aba11724', { title: 'Prepare handoff owner@example.test https://private.example', details: 'Private work-item body', account: { name: 'Private account' }, contact: { firstName: 'Private' }, team: { name: 'Private team' }, assignees: [{ member: { name: 'Private worker' } }], workItemsDependencies: { predecessors: [{ title: 'Private dependency' }] }, time: { logged: 99 }, tags: ['private-tag'], customFields: { secret: 'private' } })] } })
      .mockResolvedValueOnce({ data: { data: [workItem('62d9b8da607a89d3aba11725', { title: 'Second work item', completedOn: '2026-07-03' })] } })
      .mockResolvedValueOnce({ data: { data: [] } }) };
    const client = new RavetreeWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: () => ({ token: 'ravetree-token' }) } });
    try {
      const result = await client.fetchDelta(account);
      expect(http.get).toHaveBeenNthCalledWith(1, 'https://openapi.ravetree.com/v2/work-items', expect.objectContaining({ params: { offset: 0, limit: 1 }, headers: { Accept: 'application/json', Authorization: 'ravetree-token' }, timeout: 15000, maxRedirects: 0, proxy: false }));
      expect(http.get).toHaveBeenNthCalledWith(2, 'https://openapi.ravetree.com/v2/work-items', expect.objectContaining({ params: { offset: 1, limit: 1 } }));
      expect(http).not.toHaveProperty('post');
      expect(result).toMatchObject({ metadata: { source: 'ravetree_work_item_metadata', workItems: 2, pages: 3 }, records: [expect.objectContaining({ workItemId: '62d9b8da607a89d3aba11724', name: 'Prepare handoff [redacted email] [redacted url]', status: 'open', dueAt: '2026-07-10T00:00:00.000Z' }), expect.objectContaining({ workItemId: '62d9b8da607a89d3aba11725', status: 'done' })] });
      expect(JSON.stringify(result.records)).not.toMatch(/ravetree-token|Private work-item|Private account|Private worker|Private dependency|private-tag|private\.example|owner@example\.test/i);
    } finally {
      if (previousPageSize === undefined) delete process.env.SNEUP_RAVETREE_PAGE_SIZE;
      else process.env.SNEUP_RAVETREE_PAGE_SIZE = previousPageSize;
    }
  });

  test('fails closed for invalid cursors, credentials, response metadata, and caps', async () => {
    const credentials = { getAccountCredentials: () => ({ token: 'ravetree-token' }) };
    await expect(new RavetreeWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: credentials }).fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });
    await expect(new RavetreeWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: { getAccountCredentials: () => ({}) } }).fetchDelta(account)).rejects.toMatchObject({ statusCode: 503 });
    await expect(new RavetreeWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { data: [{ id: '1', title: 'Private', updated: { at: 'bad-date' } }] } }) }, accountConnectorService: credentials }).fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
    const previousLimit = process.env.SNEUP_RAVETREE_MAX_WORK_ITEMS;
    process.env.SNEUP_RAVETREE_MAX_WORK_ITEMS = '1';
    try {
      await expect(new RavetreeWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { data: [workItem()] } }) }, accountConnectorService: credentials }).fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 });
    } finally {
      if (previousLimit === undefined) delete process.env.SNEUP_RAVETREE_MAX_WORK_ITEMS;
      else process.env.SNEUP_RAVETREE_MAX_WORK_ITEMS = previousLimit;
    }
  });

  test('registers a read-only credential-backed adapter with no apply action', () => {
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('ravetree');
    expect(adapter).toMatchObject({ connectorId: 'ravetree', capabilities: { credentialBackedSync: true, fetchDelta: true, applyAction: false } });
    expect(adapter.normalize({ connectorId: 'ravetree' }, { id: 'work_item:62d9b8da607a89d3aba11724', sourceType: 'work_item', workItemId: '62d9b8da607a89d3aba11724', name: 'Prepare handoff', status: 'open' })).toMatchObject({ sourceType: 'work_item', title: 'Prepare handoff', url: undefined, owners: [], labels: expect.arrayContaining(['ravetree', 'work_item', 'open']), raw: { workItemId: '62d9b8da607a89d3aba11724' } });
  });
});
