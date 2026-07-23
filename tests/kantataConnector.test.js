const { KantataWorkSignalClient } = require('../src/services/kantataWorkSignalClient');

describe('Kantata OX connector', () => {
  const account = { connectorId: 'kantata', metadata: { fields: {} } };
  const credentials = { getAccountCredentials: () => ({ accessToken: 'kantata-token' }) };

  test('reads canonical bounded workspace metadata without retaining private project content', async () => {
    const http = { get: jest.fn().mockResolvedValue({ data: {
      count: 2,
      results: [{ key: 'workspaces', id: '11' }, { key: 'workspaces', id: '12' }],
      workspaces: {
        11: {
          id: '11', title: 'Launch owner@example.test https://private.example', status: 'active',
          created_at: '2026-07-10T00:00:00.000Z', updated_at: '2026-07-12T00:00:00.000Z',
          description: 'Do not retain this.', budget: 99
        },
        12: {
          id: '12', title: 'Closed rollout', status: 'closed',
          created_at: '2026-07-11T00:00:00.000Z', updated_at: '2026-07-13T00:00:00.000Z',
          people: [{ name: 'Do not retain this person.' }]
        }
      }
    } }) };
    const client = new KantataWorkSignalClient({ http, accountConnectorService: credentials });

    const result = await client.fetchDelta(account, '2026-07-10T00:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith('https://api.mavenlink.com/api/v1/workspaces.json', expect.objectContaining({
      params: { page: 1, per_page: 100 },
      headers: expect.objectContaining({ Authorization: 'Bearer kantata-token' }),
      maxContentLength: 1000000,
      maxBodyLength: 1000000,
      maxRedirects: 0,
      proxy: false
    }));
    expect(http).not.toHaveProperty('post');
    expect(result.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'project:11', name: 'Launch [redacted email] [redacted url]', status: 'in_progress' }),
      expect.objectContaining({ id: 'project:12', name: 'Closed rollout', status: 'done' })
    ]));
    expect(result.nextCursor).toBe('2026-07-13T00:00:00.000Z');
    expect(result.metadata).toMatchObject({ source: 'kantata_ox_workspace_metadata', projects: 2, scannedProjects: 2 });
    expect(JSON.stringify(result)).not.toMatch(/Do not retain|owner@example\.test|private\.example|kantata-token/);
  });

  test('paginates safely and fails closed at the configured project limit', async () => {
    const originalPageSize = process.env.SNEUP_KANTATA_PAGE_SIZE;
    const originalMaxProjects = process.env.SNEUP_KANTATA_MAX_PROJECTS;
    process.env.SNEUP_KANTATA_PAGE_SIZE = '1';
    process.env.SNEUP_KANTATA_MAX_PROJECTS = '2';
    try {
      const http = { get: jest.fn()
        .mockResolvedValueOnce({ data: { count: 2, results: [{ key: 'workspaces', id: '1' }], workspaces: { 1: { id: '1', title: 'First' } } } })
        .mockResolvedValueOnce({ data: { count: 2, results: [{ key: 'workspaces', id: '2' }], workspaces: { 2: { id: '2', title: 'Second' } } } }) };
      const client = new KantataWorkSignalClient({ http, accountConnectorService: credentials });
      await expect(client.fetchDelta(account, null)).resolves.toMatchObject({ records: [{ id: 'project:1' }, { id: 'project:2' }] });
      expect(http.get).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ params: { page: 2, per_page: 1 } }));

      const overLimitClient = new KantataWorkSignalClient({
        http: { get: jest.fn().mockResolvedValue({ data: { count: 3, results: [], workspaces: {} } }) },
        accountConnectorService: credentials
      });
      await expect(overLimitClient.fetchDelta(account, null)).rejects.toMatchObject({ statusCode: 413 });
    } finally {
      if (originalPageSize === undefined) delete process.env.SNEUP_KANTATA_PAGE_SIZE;
      else process.env.SNEUP_KANTATA_PAGE_SIZE = originalPageSize;
      if (originalMaxProjects === undefined) delete process.env.SNEUP_KANTATA_MAX_PROJECTS;
      else process.env.SNEUP_KANTATA_MAX_PROJECTS = originalMaxProjects;
    }
  });

  test('rejects malformed provider pages and keeps the adapter provider-write blocked', async () => {
    const client = new KantataWorkSignalClient({
      http: { get: jest.fn().mockResolvedValue({ data: { results: [{ key: 'stories', id: '1' }], workspaces: {} } }) },
      accountConnectorService: credentials
    });
    await expect(client.fetchDelta(account, null)).rejects.toMatchObject({ statusCode: 502 });
    await expect(new KantataWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: { getAccountCredentials: () => ({}) } }).fetchDelta(account, null)).rejects.toMatchObject({ statusCode: 503 });

    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const adapter = workSignalAdapterService.getAdapter('kantata');
    expect(adapter.capabilities).toMatchObject({ credentialBackedSync: true, fetchDelta: true, applyAction: false });
    const normalized = adapter.normalize(account, {
      id: 'project:11', projectId: '11', name: 'Launch', status: 'open',
      dueAt: '2026-07-20T00:00:00.000Z', description: 'Private description', webUrl: 'https://private.example'
    });
    expect(normalized).toMatchObject({ externalId: 'project:11', title: 'Launch', description: '', evidenceRefs: [{ externalId: 'project:11' }] });
    expect(JSON.stringify(normalized)).not.toMatch(/Private description|private\.example/);
    await expect(adapter.applyAction(account, {})).rejects.toMatchObject({ statusCode: 403 });
  });
});
