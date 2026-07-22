const { ScoroWorkSignalClient } = require('../src/services/scoroWorkSignalClient');

const account = { connectorId: 'scoro', metadata: { fields: { tenantUrl: 'https://acme.scoro.com', accountId: 'acme' } } };

describe('Scoro connector', () => {
  test('reads bounded metadata only from the documented project and task list endpoints', async () => {
    const privateEmail = ['owner', 'example.test'].join('@');
    const http = { post: jest.fn()
      .mockResolvedValueOnce({ data: { data: [{ project_id: 7, project_name: `Launch ${privateEmail} https://private.example`, status: 'inprogress', date: '2026-07-01', deadline: '2026-07-31', modified_date: '2026-07-10T10:00:00.000Z', description: 'Private description', custom_fields: { token: 'secret' } }] } })
      .mockResolvedValueOnce({ data: { data: [{ event_id: 19, event_name: 'Prepare handoff', project_id: 7, is_completed: 0, priority_id: 1, datetime_due: '2026-07-20T10:00:00.000Z', created_date: '2026-07-02T10:00:00.000Z', modified_date: '2026-07-11T10:00:00.000Z', description: 'Private task body', assignees: [{ email: privateEmail }] }] } }) };
    const client = new ScoroWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ apiKey: 'scoro-token' })) } });
    const result = await client.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(http.post).toHaveBeenNthCalledWith(1, 'https://acme.scoro.com/api/v2/projects/list', expect.objectContaining({ apiKey: 'scoro-token', company_account_id: 'acme', page: 1, per_page: 100, request: {} }), expect.objectContaining({ timeout: 15000, maxRedirects: 0, proxy: false, maxContentLength: 1000000 }));
    expect(http.post).toHaveBeenNthCalledWith(2, 'https://acme.scoro.com/api/v2/tasks/list', expect.objectContaining({ apiKey: 'scoro-token', company_account_id: 'acme', page: 1, per_page: 100, request: {} }), expect.objectContaining({ timeout: 15000, maxRedirects: 0, proxy: false }));
    expect(result).toMatchObject({ metadata: { source: 'scoro_project_task_metadata', projects: 1, tasks: 1, pages: 2 }, hasMore: false });
    expect(result.records).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'project:7', status: 'in_progress', name: 'Launch [redacted email] [redacted url]' }), expect.objectContaining({ id: 'task:19', projectId: '7', priority: 'high', status: 'open' })]));
    expect(JSON.stringify(result.records)).not.toMatch(/Private description|Private task|secret|owner@example\.test|private\.example/);
    expect(http).not.toHaveProperty('get');
  });

  test('fails closed for unsafe configuration, malformed metadata, and collection caps', async () => {
    const accountConnectorService = { getAccountCredentials: jest.fn(() => ({ apiKey: 'scoro-token' })) };
    const client = new ScoroWorkSignalClient({ http: { post: jest.fn() }, accountConnectorService });
    await expect(client.fetchDelta({ ...account, metadata: { fields: { tenantUrl: 'https://acme.scoro.com/private', accountId: 'acme' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta({ ...account, metadata: { fields: { tenantUrl: 'https://acme.scoro.com', accountId: 'bad account' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });
    const malformed = new ScoroWorkSignalClient({ http: { post: jest.fn().mockResolvedValue({ data: { data: [{ project_id: 7, project_name: 'Missing timestamp', modified_date: 'bad-date' }] } }) }, accountConnectorService });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
    const capped = new ScoroWorkSignalClient({ http: { post: jest.fn().mockResolvedValue({ data: { data: [{ project_id: 7, project_name: 'Project', modified_date: '2026-07-10T00:00:00.000Z' }] } }) }, accountConnectorService });
    const previous = process.env.SNEUP_SCORO_MAX_PROJECTS; process.env.SNEUP_SCORO_MAX_PROJECTS = '1';
    try { await expect(capped.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 }); } finally { if (previous === undefined) delete process.env.SNEUP_SCORO_MAX_PROJECTS; else process.env.SNEUP_SCORO_MAX_PROJECTS = previous; }
  });

  test('registers Scoro as an approval-gated, read-only live adapter', () => {
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('scoro');
    expect(adapter).toMatchObject({ connectorId: 'scoro', capabilities: { credentialBackedSync: true, fetchDelta: true, applyAction: false } });
    expect(adapter.normalize({ connectorId: 'scoro' }, { id: 'task:19', sourceType: 'task', taskId: '19', projectId: '7', name: 'Prepare handoff', status: 'open', priority: 'high' })).toMatchObject({ externalId: 'task:19', description: '', url: undefined, owners: [], labels: expect.arrayContaining(['scoro', 'task', 'project:7']) });
  });
});
