const { ProductiveWorkSignalClient } = require('../src/services/productiveWorkSignalClient');

const account = { connectorId: 'productive', metadata: { fields: { organizationId: '42' } } };
const project = (id = '101', attributes = {}) => ({ type: 'projects', id, attributes: { name: 'Launch site', created_at: '2026-07-01T10:00:00Z', updated_at: '2026-07-02T10:00:00Z', ...attributes } });

describe('Productive connector', () => {
  test('reads bounded JSON:API project metadata only', async () => {
    const http = { get: jest.fn()
      .mockResolvedValueOnce({ data: { data: [project()], links: { next: 'https://api.productive.io/api/v2/projects?page[number]=2' } } })
      .mockResolvedValueOnce({ data: { data: [project('102', { name: 'Second project' })], links: { next: null } } }) };
    const client = new ProductiveWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: () => ({ token: 'productive-token' }) } });
    const result = await client.fetchDelta(account);
    expect(http.get).toHaveBeenCalledWith('https://api.productive.io/api/v2/projects', expect.objectContaining({ params: { 'page[number]': 1, 'page[size]': 100 }, headers: expect.objectContaining({ 'X-Auth-Token': 'productive-token', 'X-Organization-Id': '42' }), maxRedirects: 0, proxy: false }));
    expect(result).toMatchObject({ metadata: { source: 'productive_project_metadata', projects: 2, pages: 2 }, records: [expect.objectContaining({ projectId: '101', name: 'Launch site' }), expect.objectContaining({ projectId: '102' })] });
    expect(JSON.stringify(result.records)).not.toMatch(/productive-token|budget|resource|invoice|https:\/\//i);
  });

  test('fails closed for invalid organization, cursor, token, metadata, and caps', async () => {
    const credentials = { getAccountCredentials: () => ({ token: 'productive-token' }) };
    await expect(new ProductiveWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: credentials }).fetchDelta({ ...account, metadata: { fields: { organizationId: 'org-42' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(new ProductiveWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: credentials }).fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });
    await expect(new ProductiveWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: { getAccountCredentials: () => ({}) } }).fetchDelta(account)).rejects.toMatchObject({ statusCode: 503 });
    await expect(new ProductiveWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { data: [{ type: 'tasks', id: '1', attributes: { name: 'Task' } }] } }) }, accountConnectorService: credentials }).fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
    process.env.SNEUP_PRODUCTIVE_MAX_PROJECTS = '1';
    await expect(new ProductiveWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { data: [project()], links: { next: 'next' } } }) }, accountConnectorService: credentials }).fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 });
    delete process.env.SNEUP_PRODUCTIVE_MAX_PROJECTS;
  });

  test('registers a read-only credential-backed adapter with no apply action', () => {
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('productive');
    expect(adapter).toMatchObject({ connectorId: 'productive', capabilities: { credentialBackedSync: true, fetchDelta: true, applyAction: false } });
    expect(adapter.normalize({ connectorId: 'productive' }, { id: 'project:101', sourceType: 'project', projectId: '101', name: 'Launch', status: 'open' })).toMatchObject({ sourceType: 'project', title: 'Launch', url: undefined, owners: [], labels: expect.arrayContaining(['productive', 'project', 'open']), raw: { projectId: '101' } });
  });
});
