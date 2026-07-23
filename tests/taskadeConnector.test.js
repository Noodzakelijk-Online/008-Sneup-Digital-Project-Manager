const { TaskadeWorkSignalClient } = require('../src/services/taskadeWorkSignalClient');
const { getConnector } = require('../src/services/connectorRegistry');
const { buildConnectorSafetyProfile } = require('../src/services/connectorSafetyProfile');

const account = { connectorId: 'taskade', metadata: { fields: { workspaceId: 'workspace_1' } } };

describe('Taskade connector', () => {
  test('reads only bounded project and task metadata from the selected workspace', async () => {
    const http = { get: jest.fn()
      .mockResolvedValueOnce({ data: { ok: true, items: [{ id: 'project_1', name: 'Launch owner@example.test https://private.example', notes: 'Private plan' }] } })
      .mockResolvedValueOnce({ data: { ok: true, items: [{ id: 'folder_1', name: 'Private folder' }] } })
      .mockResolvedValueOnce({ data: { ok: true, items: [{ id: 'project_2', name: 'Delivery' }] } })
      .mockResolvedValueOnce({ data: { ok: true, items: [{ id: 'task_1', text: 'Ship owner@example.test https://private.example/task', completed: false, parentId: 'private-parent', note: 'Private task body', assignees: [{ email: 'owner@example.test' }] }] } })
      .mockResolvedValueOnce({ data: { ok: true, items: [{ id: 'task_2', text: 'Hand over', completed: true, comments: [{ body: 'Private' }] }] } }) };
    const client = new TaskadeWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: () => ({ token: 'taskade-token' }) } });
    const result = await client.fetchDelta(account);

    expect(http.get).toHaveBeenNthCalledWith(1, 'https://www.taskade.com/api/v1/folders/workspace_1/projects', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer taskade-token' }), timeout: 15000, maxContentLength: 1000000, maxBodyLength: 1000000, maxRedirects: 0, proxy: false }));
    expect(http.get).toHaveBeenNthCalledWith(4, 'https://www.taskade.com/api/v1/projects/project_1/tasks', expect.objectContaining({ params: { limit: 100 } }));
    expect(http).not.toHaveProperty('post');
    expect(result).toMatchObject({ metadata: { source: 'taskade_api', workspaceId: 'workspace_1', projects: 2, tasks: 2 } });
    expect(result.records).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'project:project_1', name: 'Launch [redacted email] [redacted url]' }), expect.objectContaining({ id: 'task:task_1', projectId: 'project_1', name: 'Ship [redacted email] [redacted url]', status: 'open' }), expect.objectContaining({ id: 'task:task_2', status: 'done' })]));
    expect(JSON.stringify(result.records)).not.toMatch(/Private plan|Private folder|Private task body|owner@example\.test|private\.example|private-parent|assignees|comments/);
    expect(result.metadata.contentPolicy).toContain('no_descriptions_notes_comments_files_people_parent_task_ids_provider_urls_or_writes');
  });

  test('fails closed for invalid workspace IDs, malformed pages, invalid cursors, and caps', async () => {
    const credentials = { getAccountCredentials: () => ({ token: 'taskade-token' }) };
    const client = new TaskadeWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: credentials });
    await expect(client.fetchDelta({ metadata: { fields: { workspaceId: 'workspace/private' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });
    const malformed = new TaskadeWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { ok: false, items: [] } }) }, accountConnectorService: credentials });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
    const capped = new TaskadeWorkSignalClient({ http: { get: jest.fn()
      .mockResolvedValueOnce({ data: { ok: true, items: [{ id: 'project_1', name: 'One' }] } })
      .mockResolvedValueOnce({ data: { ok: true, items: [] } })
      .mockResolvedValueOnce({ data: { ok: true, items: [{ id: 'task_1', text: 'One', completed: false }, { id: 'task_2', text: 'Two', completed: false }] } }) }, accountConnectorService: credentials });
    const previous = process.env.SNEUP_TASKADE_MAX_TASKS; process.env.SNEUP_TASKADE_MAX_TASKS = '1';
    try { await expect(capped.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 }); } finally { if (previous === undefined) delete process.env.SNEUP_TASKADE_MAX_TASKS; else process.env.SNEUP_TASKADE_MAX_TASKS = previous; }
  });

  test('registers Taskade as an approval-gated, read-only live adapter', () => {
    const connector = getConnector('taskade');
    expect(connector.auth).toMatchObject({ type: 'personal_access_token', fields: expect.arrayContaining([expect.objectContaining({ name: 'workspaceId' })]) });
    expect(buildConnectorSafetyProfile(connector)).toMatchObject({ scopeRisk: 'guarded', providerWritesBlocked: true });
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('taskade');
    expect(adapter).toMatchObject({ connectorId: 'taskade', capabilities: { credentialBackedSync: true, fetchDelta: true, applyAction: false } });
    expect(adapter.normalize(account, { id: 'task:task_1', sourceType: 'task', taskId: 'task_1', projectId: 'project_1', name: 'Ship', status: 'open' })).toMatchObject({ externalId: 'task:task_1', description: '', url: undefined, owners: [], labels: expect.arrayContaining(['taskade', 'task', 'project:project_1']), raw: { taskId: 'task_1' } });
  });
});
