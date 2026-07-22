const { TeamGanttWorkSignalClient } = require('../src/services/teamganttWorkSignalClient');

describe('TeamGantt connector', () => {
  const account = { metadata: { fields: { companyId: '12345' } } };
  const credentials = { getAccountCredentials: () => ({ token: 'teamgantt-token' }) };

  test('reads bounded project and task metadata with size limits and redacted titles', async () => {
    const http = { get: jest.fn()
      .mockResolvedValueOnce({ data: { data: [{ id: 10, name: 'Client email@example.test https://private.example/project', status: 'active', description: 'Private project description' }] } })
      .mockResolvedValueOnce({ data: { data: [{ id: 20, project_id: 10, name: 'Launch email@example.test https://private.example/task', status: 'in progress', priority: 'high', end_date: '2026-07-21T12:00:00.000Z', notes: 'Private task notes' }], meta: { total: 1 } } }) };
    const client = new TeamGanttWorkSignalClient({ http, accountConnectorService: credentials });

    const result = await client.fetchDelta(account, null);

    expect(http.get).toHaveBeenNthCalledWith(1, 'https://api.teamgantt.com/v1/companies/12345/projects', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer teamgantt-token' }), maxContentLength: 2000000, maxBodyLength: 2000000, maxRedirects: 0, proxy: false
    }));
    expect(http.get).toHaveBeenNthCalledWith(2, 'https://api.teamgantt.com/v1/tasks', expect.objectContaining({
      params: { 'project_ids[]': ['10'], page: 1, per_page: 100 }, maxContentLength: 2000000, maxBodyLength: 2000000, maxRedirects: 0, proxy: false
    }));
    expect(result.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'project:10', name: 'Client [redacted email] [redacted url]' }),
      expect.objectContaining({ id: 'task:20', name: 'Launch [redacted email] [redacted url]', project: { id: '10', name: 'Client [redacted email] [redacted url]' } })
    ]));
    expect(JSON.stringify(result)).not.toMatch(/Private project description|Private task notes|email@example\.test|private\.example|teamgantt-token/);
    expect(result.metadata.contentPolicy).toContain('with_redacted_titles');
  });

  test('fails closed for invalid company IDs, cursors, and response limits', async () => {
    const client = new TeamGanttWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: credentials });
    await expect(client.fetchDelta({ metadata: { fields: { companyId: 'https://private.example' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });

    const originalLimit = process.env.SNEUP_TEAMGANTT_MAX_RESPONSE_BYTES;
    process.env.SNEUP_TEAMGANTT_MAX_RESPONSE_BYTES = '1';
    try {
      expect(client.getConfig(account).maxResponseBytes).toBe(1024);
    } finally {
      if (originalLimit === undefined) delete process.env.SNEUP_TEAMGANTT_MAX_RESPONSE_BYTES;
      else process.env.SNEUP_TEAMGANTT_MAX_RESPONSE_BYTES = originalLimit;
    }
  });

  test('keeps TeamGantt adapter evidence URL-free and project fields allowlisted', () => {
    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(workSignalAdapterService.getAdapter('teamgantt').capabilities).toMatchObject({ credentialBackedSync: true, applyAction: false });
    const normalized = workSignalAdapterService.normalize({ connectorId: 'teamgantt' }, { id: 'task:20', taskId: '20', projectId: '10', name: 'Launch', project: { id: '10', name: 'Project', webUrl: 'https://private.example/project', description: 'Private project description' }, webUrl: 'https://private.example/task', description: 'Private task description' });
    expect(normalized).toMatchObject({ externalId: 'task:20', title: 'Launch', description: '', evidenceRefs: [{ externalId: 'task:20' }], raw: { project: { id: '10', name: 'Project' } } });
    expect(normalized.evidenceRefs[0]).not.toHaveProperty('url');
    expect(JSON.stringify(normalized)).not.toMatch(/private\.example|Private project description|Private task description/);
  });
});
