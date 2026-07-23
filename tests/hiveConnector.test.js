const { HiveWorkSignalClient } = require('../src/services/hiveWorkSignalClient');

const account = { connectorId: 'hive', metadata: { fields: { workspaceId: 'workspace-1', userId: 'user-1' } } };

describe('Hive connector', () => {
  test('reads bounded project metadata only from the documented workspace project endpoint', async () => {
    const privateEmail = ['owner', 'example.test'].join('@');
    const http = { get: jest.fn().mockResolvedValue({ data: { data: [{ id: 'project-1', name: `Launch ${privateEmail} https://private.example`, status: { name: 'In Progress' }, createdAt: '2026-07-01T00:00:00.000Z', modifiedAt: '2026-07-11T00:00:00.000Z', description: 'Private project body', actions: [{ title: 'Private action' }], people: [{ email: privateEmail }], files: [{ name: 'private.pdf' }] }], pageInfo: { hasNextPage: false } } }) };
    const client = new HiveWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ apiKey: 'hive-key' })) } });
    const result = await client.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith('https://app.hive.com/api/v2/workspaces/workspace-1/projects', expect.objectContaining({ params: expect.objectContaining({ user_id: 'user-1', first: 100, 'filters[archived]': false, sortBy: 'modifiedAt asc' }), headers: expect.objectContaining({ api_key: 'hive-key', Accept: 'application/json' }), timeout: 15000, maxContentLength: 1000000, maxRedirects: 0, proxy: false }));
    expect(result).toMatchObject({ metadata: { source: 'hive_project_metadata', projects: 1, pages: 1 }, hasMore: false });
    expect(result.records).toEqual([expect.objectContaining({ id: 'project:project-1', projectId: 'project-1', status: 'in_progress', name: 'Launch [redacted email] [redacted url]' })]);
    expect(JSON.stringify(result.records)).not.toMatch(/Private project body|Private action|private\.pdf|owner@example\.test|private\.example/);
    expect(http).not.toHaveProperty('post');
  });

  test('follows bounded provider cursors and fails closed for invalid configuration, pages, and caps', async () => {
    const firstPage = { data: { data: [{ id: 'project-1', name: 'First project', modifiedAt: '2026-07-11T00:00:00.000Z' }], pageInfo: { hasNextPage: true, endCursor: 'next-page' } } };
    const secondPage = { data: { data: [{ id: 'project-2', name: 'Second project', modifiedAt: '2026-07-12T00:00:00.000Z' }], pageInfo: { hasNextPage: false } } };
    const accountConnectorService = { getAccountCredentials: jest.fn(() => ({ apiKey: 'hive-key' })) };
    const http = { get: jest.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage) };
    const client = new HiveWorkSignalClient({ http, accountConnectorService });
    const result = await client.fetchDelta(account);
    expect(http.get.mock.calls[1][1].params).toMatchObject({ after: 'next-page' });
    expect(result.records).toHaveLength(2);

    await expect(client.fetchDelta({ ...account, metadata: { fields: { workspaceId: 'bad workspace', userId: 'user-1' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });
    const malformed = new HiveWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { data: [{ id: 'project-1', name: 'Broken', modifiedAt: 'bad-date' }] } }) }, accountConnectorService });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
    const capped = new HiveWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { data: [{ id: 'project-1', name: 'Project' }], pageInfo: { hasNextPage: true, endCursor: 'next-page' } } }) }, accountConnectorService });
    const previous = process.env.SNEUP_HIVE_MAX_PROJECTS; process.env.SNEUP_HIVE_MAX_PROJECTS = '1';
    try { await expect(capped.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 }); } finally { if (previous === undefined) delete process.env.SNEUP_HIVE_MAX_PROJECTS; else process.env.SNEUP_HIVE_MAX_PROJECTS = previous; }
  });

  test('registers Hive as an approval-gated, read-only live adapter', () => {
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('hive');
    expect(adapter).toMatchObject({ connectorId: 'hive', capabilities: { credentialBackedSync: true, fetchDelta: true, applyAction: false } });
    expect(adapter.normalize({ connectorId: 'hive' }, { id: 'project:project-1', sourceType: 'project', projectId: 'project-1', name: 'Launch', status: 'open' })).toMatchObject({ externalId: 'project:project-1', description: '', url: undefined, owners: [], labels: expect.arrayContaining(['hive', 'project', 'project:project-1']) });
  });
});
