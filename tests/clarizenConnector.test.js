const { ClarizenWorkSignalClient } = require('../src/services/clarizenWorkSignalClient');

const account = { connectorId: 'clarizen', metadata: { fields: { tenantUrl: 'https://api.clarizen.com' } } };

describe('Clarizen connector', () => {
  test('runs only the documented bounded EntityQuery project read', async () => {
    const privateEmail = ['owner', 'example.test'].join('@');
    const http = { post: jest.fn().mockResolvedValue({ data: { entities: [{ id: '/Project/project-1', name: `Launch ${privateEmail} https://private.example`, startDate: '2026-07-01T00:00:00.000Z', description: 'Private project body', assignments: [{ user: privateEmail }], customFields: { secret: 'hidden' } }] } }) };
    const client = new ClarizenWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ apiKey: 'clarizen-key' })) } });
    const result = await client.fetchDelta(account);

    expect(http.post).toHaveBeenCalledWith('https://api.clarizen.com/v2.0/services/data/EntityQuery', { typeName: 'Project', fields: ['Name', 'StartDate'], orders: [{ fieldName: 'StartDate', order: 'Ascending' }], paging: { From: 0, Limit: 100 } }, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'ApiKey clarizen-key', Accept: 'application/json' }), timeout: 15000, maxContentLength: 1000000, maxRedirects: 0, proxy: false }));
    expect(result).toMatchObject({ metadata: { source: 'clarizen_project_metadata', projects: 1, pages: 1 }, hasMore: false, nextCursor: null });
    expect(result.records).toEqual([expect.objectContaining({ id: 'project:project-1', projectId: 'project-1', name: 'Launch [redacted email] [redacted url]', startAt: '2026-07-01T00:00:00.000Z' })]);
    expect(JSON.stringify(result.records)).not.toMatch(/Private project body|secret|owner@example\.test|private\.example/);
    expect(http).not.toHaveProperty('get');
  });

  test('fails closed for unsafe regions, malformed provider records, cursors, and caps', async () => {
    const accountConnectorService = { getAccountCredentials: jest.fn(() => ({ apiKey: 'clarizen-key' })) };
    const client = new ClarizenWorkSignalClient({ http: { post: jest.fn() }, accountConnectorService });
    await expect(client.fetchDelta({ ...account, metadata: { fields: { tenantUrl: 'https://api.clarizen.com/v2.0' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta({ ...account, metadata: { fields: { tenantUrl: 'https://private.example' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta(account, 'unexpected-cursor')).rejects.toMatchObject({ statusCode: 400 });
    const malformed = new ClarizenWorkSignalClient({ http: { post: jest.fn().mockResolvedValue({ data: { entities: [{ id: '/Project/project-1', name: 'Broken', startDate: 'bad-date' }] } }) }, accountConnectorService });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
    const capped = new ClarizenWorkSignalClient({ http: { post: jest.fn().mockResolvedValue({ data: { entities: [{ id: '/Project/project-1', name: 'Project' }] } }) }, accountConnectorService });
    const previous = process.env.SNEUP_CLARIZEN_MAX_PROJECTS; process.env.SNEUP_CLARIZEN_MAX_PROJECTS = '1';
    try { await expect(capped.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 }); } finally { if (previous === undefined) delete process.env.SNEUP_CLARIZEN_MAX_PROJECTS; else process.env.SNEUP_CLARIZEN_MAX_PROJECTS = previous; }
  });

  test('registers Clarizen as an approval-gated, read-only live adapter', () => {
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('clarizen');
    expect(adapter).toMatchObject({ connectorId: 'clarizen', capabilities: { credentialBackedSync: true, fetchDelta: true, applyAction: false } });
    expect(adapter.normalize({ connectorId: 'clarizen' }, { id: 'project:project-1', sourceType: 'project', projectId: 'project-1', name: 'Launch', status: 'open' })).toMatchObject({ externalId: 'project:project-1', description: '', url: undefined, owners: [], labels: expect.arrayContaining(['clarizen', 'project', 'project:project-1']) });
  });
});
