const { TaskworldWorkSignalClient } = require('../src/services/taskworldWorkSignalClient');

const account = { connectorId: 'taskworld', metadata: { fields: { apiUrl: 'https://us.taskworld.com/api/public/v1', spaceId: 'space-1' } } };

describe('Taskworld connector', () => {
  test('runs only the documented bounded project.get-all read', async () => {
    const privateEmail = ['owner', 'example.test'].join('@');
    const http = { post: jest.fn().mockResolvedValue({ data: { ok: true, projects: [{ project_id: 'project-1', title: `Launch ${privateEmail} https://private.example`, created: '2026-07-01T00:00:00.000Z', updated: '2026-07-11T00:00:00.000Z', description: 'Private project body', members: [{ email: privateEmail }], tasks: ['task-1'], files: [{ name: 'private.pdf' }] }] } }) };
    const client = new TaskworldWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ apiKey: 'taskworld-token' })) } });
    const result = await client.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(http.post).toHaveBeenCalledWith('https://us.taskworld.com/api/public/v1/project.get-all', { access_token: 'taskworld-token', space_id: 'space-1', limit: 500 }, expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json' }), timeout: 15000, maxContentLength: 1000000, maxRedirects: 0, proxy: false }));
    expect(result).toMatchObject({ metadata: { source: 'taskworld_project_metadata', projects: 1, pages: 1 }, hasMore: false });
    expect(result.records).toEqual([expect.objectContaining({ id: 'project:project-1', projectId: 'project-1', name: 'Launch [redacted email] [redacted url]' })]);
    expect(JSON.stringify(result.records)).not.toMatch(/Private project body|task-1|private\.pdf|owner@example\.test|private\.example/);
    expect(http).not.toHaveProperty('get');
  });

  test('fails closed for unsafe regions, malformed records, cursors, and the documented-page cap', async () => {
    const accountConnectorService = { getAccountCredentials: jest.fn(() => ({ apiKey: 'taskworld-token' })) };
    const client = new TaskworldWorkSignalClient({ http: { post: jest.fn() }, accountConnectorService });
    await expect(client.fetchDelta({ ...account, metadata: { fields: { apiUrl: 'https://private.example/api/public/v1', spaceId: 'space-1' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta({ ...account, metadata: { fields: { apiUrl: 'https://us.taskworld.com/api/public/v1/private', spaceId: 'space-1' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });
    const malformed = new TaskworldWorkSignalClient({ http: { post: jest.fn().mockResolvedValue({ data: { ok: true, projects: [{ project_id: 'project-1', title: 'Broken', updated: 'bad-date' }] } }) }, accountConnectorService });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
    const capped = new TaskworldWorkSignalClient({ http: { post: jest.fn().mockResolvedValue({ data: { ok: true, projects: [{ project_id: 'project-1', title: 'Project' }] } }) }, accountConnectorService });
    const previous = process.env.SNEUP_TASKWORLD_MAX_PROJECTS; process.env.SNEUP_TASKWORLD_MAX_PROJECTS = '1';
    try { await expect(capped.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 }); } finally { if (previous === undefined) delete process.env.SNEUP_TASKWORLD_MAX_PROJECTS; else process.env.SNEUP_TASKWORLD_MAX_PROJECTS = previous; }
  });

  test('registers Taskworld as an approval-gated, read-only live adapter', () => {
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('taskworld');
    expect(adapter).toMatchObject({ connectorId: 'taskworld', capabilities: { credentialBackedSync: true, fetchDelta: true, applyAction: false } });
    expect(adapter.normalize({ connectorId: 'taskworld' }, { id: 'project:project-1', sourceType: 'project', projectId: 'project-1', name: 'Launch', status: 'open' })).toMatchObject({ externalId: 'project:project-1', description: '', url: undefined, owners: [], labels: expect.arrayContaining(['taskworld', 'project', 'project:project-1']) });
  });
});
