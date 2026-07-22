const { PlaneWorkSignalClient } = require('../src/services/planeWorkSignalClient');

const projectId = '550e8400-e29b-41d4-a716-446655440000';
const workItemId = '550e8400-e29b-41d4-a716-446655440001';
const account = { connectorId: 'plane', metadata: { fields: { workspaceSlug: 'delivery-team' } } };

describe('Plane connector', () => {
  test('reads bounded metadata only from the documented project and work-item endpoints', async () => {
    const privateEmail = ['owner', 'example.test'].join('@');
    const http = { get: jest.fn()
      .mockResolvedValueOnce({ data: { next_page_results: false, total_results: 1, results: [{ id: projectId, name: `Launch ${privateEmail} https://private.example`, created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-10T10:00:00.000Z', description: 'Private project body', members: [{ email: privateEmail }] }] } })
      .mockResolvedValueOnce({ data: { next_page_results: false, total_results: 1, results: [{ id: workItemId, name: 'Prepare handoff', priority: 'high', state: { group: 'started', name: 'In progress' }, created_at: '2026-07-02T00:00:00.000Z', updated_at: '2026-07-11T10:00:00.000Z', target_date: '2026-07-20T00:00:00.000Z', description: 'Private task body', assignees: [{ email: privateEmail }] }] } }) };
    const client = new PlaneWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ apiKey: 'plane-token' })) } });
    const result = await client.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(http.get).toHaveBeenNthCalledWith(1, 'https://api.plane.so/api/v1/workspaces/delivery-team/projects/', expect.objectContaining({ params: expect.objectContaining({ per_page: 20, fields: 'id,name,created_at,updated_at' }), headers: { Accept: 'application/json', 'X-API-Key': 'plane-token' }, timeout: 15000, maxContentLength: 1000000, maxRedirects: 0, proxy: false }));
    expect(http.get).toHaveBeenNthCalledWith(2, `https://api.plane.so/api/v1/workspaces/delivery-team/projects/${projectId}/work-items/`, expect.objectContaining({ params: expect.objectContaining({ per_page: 100, expand: 'state', fields: 'id,name,priority,state,created_at,updated_at,target_date,completed_at' }), headers: { Accept: 'application/json', 'X-API-Key': 'plane-token' }, maxRedirects: 0, proxy: false }));
    expect(result).toMatchObject({ metadata: { source: 'plane_project_work_item_metadata', projects: 1, workItems: 1, pages: 2 }, hasMore: false });
    expect(result.records).toEqual(expect.arrayContaining([expect.objectContaining({ id: `project:${projectId}`, status: 'open', name: 'Launch [redacted email] [redacted url]' }), expect.objectContaining({ id: `work_item:${workItemId}`, projectId, status: 'in_progress', priority: 'high' })]));
    expect(JSON.stringify(result.records)).not.toMatch(/Private project|Private task|owner@example\.test|private\.example/);
    expect(http).not.toHaveProperty('post');
  });

  test('fails closed for unsafe configuration, malformed pages, and collection caps', async () => {
    const accountConnectorService = { getAccountCredentials: jest.fn(() => ({ apiKey: 'plane-token' })) };
    const client = new PlaneWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService });
    await expect(client.fetchDelta({ ...account, metadata: { fields: { workspaceSlug: 'delivery team' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });
    const malformed = new PlaneWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { next_page_results: true, next_cursor: '', total_results: 1, results: [] } }) }, accountConnectorService });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
    const capped = new PlaneWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { next_page_results: false, total_results: 2, results: [{ id: projectId, name: 'One project' }, { id: workItemId, name: 'Two project' }] } }) }, accountConnectorService });
    const previous = process.env.SNEUP_PLANE_MAX_PROJECTS; process.env.SNEUP_PLANE_MAX_PROJECTS = '1';
    try { await expect(capped.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 }); } finally { if (previous === undefined) delete process.env.SNEUP_PLANE_MAX_PROJECTS; else process.env.SNEUP_PLANE_MAX_PROJECTS = previous; }
  });

  test('registers Plane as an approval-gated, read-only live adapter', () => {
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('plane');
    expect(adapter).toMatchObject({ connectorId: 'plane', capabilities: { credentialBackedSync: true, fetchDelta: true, applyAction: false } });
    expect(adapter.normalize({ connectorId: 'plane' }, { id: `work_item:${workItemId}`, sourceType: 'work_item', workItemId, projectId, name: 'Prepare handoff', status: 'open', priority: 'high' })).toMatchObject({ externalId: `work_item:${workItemId}`, description: '', url: undefined, owners: [], labels: expect.arrayContaining(['plane', 'work_item', `project:${projectId}`]) });
  });
});
