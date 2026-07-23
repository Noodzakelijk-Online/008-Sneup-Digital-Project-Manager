const { MicrosoftProjectWorkSignalClient } = require('../src/services/microsoftProjectWorkSignalClient');

const planId = 'xqQg5FS2LkCp935s-FIFm2QAFkHM';
const taskId = '01gzSlKkIUSUl6DF_EilrmQAKDhh';
const account = { connectorId: 'microsoft_project' };

describe('Microsoft Project connector', () => {
  test('reads bounded basic Planner plan and task metadata without requesting project details or provider writes', async () => {
    const privateEmail = ['owner', 'example.test'].join('@');
    const http = { get: jest.fn()
      .mockResolvedValueOnce({ data: { value: [{ id: planId, title: `Delivery ${privateEmail} https://private.example`, createdDateTime: '2026-07-01T00:00:00.000Z', details: { sharedWith: { private: true } } }] } })
      .mockResolvedValueOnce({ data: { value: [{ id: taskId, title: 'Prepare handoff', planId, bucketId: 'bucket-1', percentComplete: 50, priority: 'high', dueDateTime: { dateTime: '2026-07-20T00:00:00.000Z' }, createdDateTime: '2026-07-02T00:00:00.000Z', lastModifiedDateTime: '2026-07-11T10:00:00.000Z', description: 'Private task body', checklist: { secret: true }, assignments: { private: {} } }] } }) };
    const client = new MicrosoftProjectWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ accessToken: 'microsoft-token' })) } });
    const result = await client.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(http.get).toHaveBeenNthCalledWith(1, 'https://graph.microsoft.com/v1.0/me/planner/plans', expect.objectContaining({
      params: { '$select': 'id,title,createdDateTime', '$top': 50 }, headers: { Accept: 'application/json', Authorization: 'Bearer microsoft-token' }, timeout: 15000, maxContentLength: 1000000, maxRedirects: 0, proxy: false
    }));
    expect(http.get).toHaveBeenNthCalledWith(2, `https://graph.microsoft.com/v1.0/planner/plans/${planId}/tasks`, expect.objectContaining({
      params: { '$select': 'id,title,planId,bucketId,percentComplete,priority,dueDateTime,completedDateTime,createdDateTime,lastModifiedDateTime', '$top': 100 }, headers: { Accept: 'application/json', Authorization: 'Bearer microsoft-token' }, maxRedirects: 0, proxy: false
    }));
    expect(http).not.toHaveProperty('post');
    const requested = http.get.mock.calls.map(call => `${call[0]} ${JSON.stringify(call[1].params)}`).join(' ');
    expect(requested).not.toMatch(/details|description|checklist|attachments|comments|assignments|people|custom_fields/i);
    expect(result).toMatchObject({ metadata: { source: 'microsoft_project_planner_graph', projects: 1, tasks: 1, pages: 2 }, hasMore: false, nextCursor: '2026-07-11T10:00:00.000Z' });
    expect(result.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `project_plan:${planId}`, projectId: planId, name: 'Delivery [redacted email] [redacted url]' }),
      expect.objectContaining({ id: `project_task:${taskId}`, taskId, projectId: planId, status: 'in_progress', priority: 'high', percentComplete: 50 })
    ]));
    expect(JSON.stringify(result.records)).not.toMatch(/private\.example|owner@example\.test|Private task|secret/);
  });

  test('fails closed for unsafe Graph targets, malformed pages, caps, and untrusted pagination', async () => {
    const accountConnectorService = { getAccountCredentials: jest.fn(() => ({ accessToken: 'microsoft-token' })) };
    const untrustedHttp = { get: jest.fn() };
    const untrustedClient = new MicrosoftProjectWorkSignalClient({ http: untrustedHttp, accountConnectorService });
    const priorApiUrl = process.env.SNEUP_MICROSOFT_PROJECT_GRAPH_API_URL;
    process.env.SNEUP_MICROSOFT_PROJECT_GRAPH_API_URL = 'https://example.test/v1.0';
    try {
      await expect(untrustedClient.fetchDelta(account)).rejects.toMatchObject({ statusCode: 500 });
      expect(untrustedHttp.get).not.toHaveBeenCalled();
    } finally {
      if (priorApiUrl === undefined) delete process.env.SNEUP_MICROSOFT_PROJECT_GRAPH_API_URL;
      else process.env.SNEUP_MICROSOFT_PROJECT_GRAPH_API_URL = priorApiUrl;
    }

    const malformedClient = new MicrosoftProjectWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { value: [{ id: planId }] } }) }, accountConnectorService });
    await expect(malformedClient.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });

    const priorLimit = process.env.SNEUP_MICROSOFT_PROJECT_MAX_PROJECTS;
    process.env.SNEUP_MICROSOFT_PROJECT_MAX_PROJECTS = '1';
    const cappedClient = new MicrosoftProjectWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { value: [{ id: planId, title: 'First plan' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/planner/plans?$skiptoken=next' } }) }, accountConnectorService });
    try {
      await expect(cappedClient.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 });
    } finally {
      if (priorLimit === undefined) delete process.env.SNEUP_MICROSOFT_PROJECT_MAX_PROJECTS;
      else process.env.SNEUP_MICROSOFT_PROJECT_MAX_PROJECTS = priorLimit;
    }

    const paginationClient = new MicrosoftProjectWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService });
    expect(() => paginationClient.validateNextUrl('https://example.test/v1.0/me/planner/plans?$skiptoken=next', paginationClient.getConfig(), '/me/planner/plans')).toThrow(/untrusted pagination/i);
  });

  test('registers Microsoft Project as an approval-gated, read-only live adapter', () => {
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('microsoft_project');
    expect(adapter).toMatchObject({ connectorId: 'microsoft_project', capabilities: { credentialBackedSync: true, fetchDelta: true, applyAction: false } });
    expect(adapter.normalize({ connectorId: 'microsoft_project' }, { id: `project_task:${taskId}`, sourceType: 'task', taskId, projectId: planId, name: 'Prepare handoff', status: 'open', priority: 'high', description: 'Private detail' })).toMatchObject({ externalId: `project_task:${taskId}`, description: '', url: undefined, owners: [], labels: expect.arrayContaining(['microsoft_project', 'task', `project:${planId}`]) });
  });
});
