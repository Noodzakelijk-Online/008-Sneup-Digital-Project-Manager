const { TodoistWorkSignalClient } = require('../src/services/todoistWorkSignalClient');

describe('Todoist connector', () => {
  const account = { connectorId: 'todoist' };
  const credentials = { getAccountCredentials: () => ({ token: 'todoist-token' }) };

  test('uses bounded redirect-free reads and retains only redacted task metadata', async () => {
    const http = { get: jest.fn()
      .mockResolvedValueOnce({ data: [{ id: 'p-1', name: 'Sneup owner@example.test https://private.example/project', description: 'Do not retain this.' }] })
      .mockResolvedValueOnce({ data: [{
        id: 't-1', content: 'Ship owner@example.test https://private.example/task', description: 'Do not retain this.',
        comments: [{ content: 'Do not retain this.' }], attachments: [{ name: 'private.pdf' }], url: 'https://private.example/task',
        project_id: 'p-1', section_id: 's-1', assignee_id: 'member-1', priority: 3,
        due: { date: '2026-07-15' }, created_at: '2026-07-10T08:00:00.000Z'
      }] }) };
    const client = new TodoistWorkSignalClient({ http, accountConnectorService: credentials });

    const result = await client.fetchDelta(account, null);

    expect(http.get).toHaveBeenNthCalledWith(1, 'https://api.todoist.com/rest/v2/projects', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer todoist-token' }),
      maxContentLength: 1000000,
      maxBodyLength: 1000000,
      maxRedirects: 0,
      proxy: false
    }));
    expect(http.get).toHaveBeenNthCalledWith(2, 'https://api.todoist.com/rest/v2/tasks', expect.objectContaining({
      maxContentLength: 1000000,
      maxBodyLength: 1000000,
      maxRedirects: 0,
      proxy: false
    }));
    expect(http).not.toHaveProperty('post');
    expect(result.records).toEqual([expect.objectContaining({
      id: 't-1', content: 'Ship [redacted email] [redacted url]', project: { id: 'p-1', name: 'Sneup [redacted email] [redacted url]' }
    })]);
    expect(result.metadata.contentPolicy).toContain('redacted_titles');
    expect(JSON.stringify(result)).not.toMatch(/Do not retain|private\.example|owner@example\.test|private\.pdf|todoist-token/);
  });

  test('fails closed for malformed collections, invalid task metadata, and configured limits', async () => {
    const client = new TodoistWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: {} }) }, accountConnectorService: credentials });
    await expect(client.fetchDelta(account, null)).rejects.toMatchObject({ statusCode: 502 });

    const invalidTask = new TodoistWorkSignalClient({
      http: { get: jest.fn()
        .mockResolvedValueOnce({ data: [{ id: 'p-1', name: 'Sneup' }] })
        .mockResolvedValueOnce({ data: [{ id: 't-1', content: '', priority: 3 }] }) },
      accountConnectorService: credentials
    });
    await expect(invalidTask.fetchDelta(account, null)).rejects.toMatchObject({ statusCode: 502 });

    const originalLimit = process.env.SNEUP_TODOIST_MAX_RESPONSE_BYTES;
    process.env.SNEUP_TODOIST_MAX_RESPONSE_BYTES = '1';
    try {
      expect(client.getConfig().maxResponseBytes).toBe(1024);
    } finally {
      if (originalLimit === undefined) delete process.env.SNEUP_TODOIST_MAX_RESPONSE_BYTES;
      else process.env.SNEUP_TODOIST_MAX_RESPONSE_BYTES = originalLimit;
    }
  });

  test('keeps Todoist adapter evidence URL-free and raw fields allowlisted', () => {
    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const adapter = workSignalAdapterService.getAdapter('todoist');
    expect(adapter.capabilities).toMatchObject({ credentialBackedSync: true, applyAction: false });
    const normalized = adapter.normalize(account, {
      id: 't-1', content: 'Ship release', projectId: 'p-1', sectionId: 's-1', priority: 3,
      assigneeId: 'member-1', due: '2026-07-15T00:00:00.000Z', createdAt: '2026-07-10T08:00:00.000Z',
      project: { id: 'p-1', name: 'Sneup', url: 'https://private.example/project', description: 'Private project description' },
      url: 'https://private.example/task', description: 'Private task description'
    });
    expect(normalized).toMatchObject({ externalId: 't-1', title: 'Ship release', description: '', evidenceRefs: [{ externalId: 't-1' }] });
    expect(normalized.evidenceRefs[0]).not.toHaveProperty('url');
    expect(JSON.stringify(normalized)).not.toMatch(/private\.example|Private project description|Private task description/);
  });
});
