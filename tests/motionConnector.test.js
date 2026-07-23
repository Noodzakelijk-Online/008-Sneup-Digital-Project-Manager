const { MotionWorkSignalClient } = require('../src/services/motionWorkSignalClient');
const { getConnector } = require('../src/services/connectorRegistry');
const { buildConnectorSafetyProfile } = require('../src/services/connectorSafetyProfile');

const account = { connectorId: 'motion', metadata: { fields: { workspaceId: 'workspace_1' } } };

describe('Motion connector', () => {
  test('reads bounded workspace project and task metadata without private payload fields', async () => {
    const http = { get: jest.fn()
      .mockResolvedValueOnce({ data: { projects: [{ id: 'project_1', name: 'Launch owner@example.test https://private.example', status: { isResolvedStatus: false }, createdTime: '2026-07-01T00:00:00.000Z', updatedTime: '2026-07-11T00:00:00.000Z', description: 'Private project plan', customFieldValues: { secret: 'value' } }], meta: {} } })
      .mockResolvedValueOnce({ data: { tasks: [{ id: 'task_1', name: 'Ship private@example.test https://private.example/task', description: 'Private task body', creator: { email: 'owner@example.test' }, assignees: [{ email: 'owner@example.test' }], labels: [{ name: 'private' }], customFieldValues: { secret: 'value' }, project: { id: 'project_1', name: 'Private project', description: 'Private' }, status: { isResolvedStatus: false }, priority: 'HIGH', dueDate: '2026-07-20T12:00:00.000Z', startOn: '2026-07-18', duration: 90, scheduledStart: '2026-07-18T09:00:00.000Z', scheduledEnd: '2026-07-18T10:30:00.000Z', schedulingIssue: true, createdTime: '2026-07-10T00:00:00.000Z', updatedTime: '2026-07-12T00:00:00.000Z' }], meta: {} } }) };
    const client = new MotionWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: () => ({ apiKey: 'motion-key' }) } });
    const result = await client.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(http.get).toHaveBeenNthCalledWith(1, 'https://api.usemotion.com/v1/projects', expect.objectContaining({ params: { workspaceId: 'workspace_1' }, headers: expect.objectContaining({ 'X-API-Key': 'motion-key' }), maxContentLength: 1000000, maxBodyLength: 1000000, maxRedirects: 0, proxy: false }));
    expect(http.get).toHaveBeenNthCalledWith(2, 'https://api.usemotion.com/v1/tasks', expect.objectContaining({ params: { workspaceId: 'workspace_1' }, headers: expect.objectContaining({ 'X-API-Key': 'motion-key' }), maxRedirects: 0, proxy: false }));
    expect(result).toMatchObject({ metadata: { source: 'motion_api', workspaceId: 'workspace_1', projects: 1, tasks: 1 } });
    expect(result.records).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'project:project_1', name: 'Launch [redacted email] [redacted url]' }), expect.objectContaining({ id: 'task:task_1', projectId: 'project_1', priority: 'high', durationMinutes: 90, schedulingIssue: true })]));
    expect(JSON.stringify(result.records)).not.toMatch(/Private project plan|Private task body|owner@example\.test|private\.example|customFieldValues|assignees|labels/);
    expect(result.metadata.contentPolicy).toContain('no_descriptions_creator_assignees_emails');
  });

  test('follows provider cursors and fails closed for invalid workspaces, malformed pages, and caps', async () => {
    const credentials = { getAccountCredentials: () => ({ apiKey: 'motion-key' }) };
    const paged = new MotionWorkSignalClient({ http: { get: jest.fn()
      .mockResolvedValueOnce({ data: { projects: [{ id: 'project_1', name: 'One' }], meta: { nextCursor: 'project-next' } } })
      .mockResolvedValueOnce({ data: { projects: [{ id: 'project_2', name: 'Two' }], meta: {} } })
      .mockResolvedValueOnce({ data: { tasks: [], meta: {} } }) }, accountConnectorService: credentials });
    const result = await paged.fetchDelta(account);
    expect(result.metadata).toMatchObject({ projects: 2, tasks: 0 });
    expect(paged.http.get.mock.calls[1][1].params).toEqual({ workspaceId: 'workspace_1', cursor: 'project-next' });
    const invalid = new MotionWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: credentials });
    await expect(invalid.fetchDelta({ metadata: { fields: { workspaceId: 'workspace/private' } } })).rejects.toMatchObject({ statusCode: 400 });
    const malformed = new MotionWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { projects: [{ id: 'project_1', name: 'Bad', updatedTime: 'invalid' }], meta: {} } }) }, accountConnectorService: credentials });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
    const capped = new MotionWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { projects: [{ id: 'project_1', name: 'One' }], meta: { nextCursor: 'next' } } }) }, accountConnectorService: credentials });
    const previous = process.env.SNEUP_MOTION_MAX_PROJECTS; process.env.SNEUP_MOTION_MAX_PROJECTS = '1';
    try { await expect(capped.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 }); } finally { if (previous === undefined) delete process.env.SNEUP_MOTION_MAX_PROJECTS; else process.env.SNEUP_MOTION_MAX_PROJECTS = previous; }
  });

  test('registers Motion as an approval-gated, read-only live adapter', () => {
    const connector = getConnector('motion');
    expect(connector.auth).toMatchObject({ type: 'api_key', fields: expect.arrayContaining([expect.objectContaining({ name: 'workspaceId' })]) });
    expect(buildConnectorSafetyProfile(connector)).toMatchObject({ scopeRisk: 'guarded', providerWritesBlocked: true });
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('motion');
    expect(adapter).toMatchObject({ connectorId: 'motion', capabilities: { credentialBackedSync: true, fetchDelta: true, applyAction: false } });
    expect(adapter.normalize(account, { id: 'task:task_1', sourceType: 'task', taskId: 'task_1', projectId: 'project_1', name: 'Ship', priority: 'high', schedulingIssue: true })).toMatchObject({ externalId: 'task:task_1', description: '', url: undefined, owners: [], labels: expect.arrayContaining(['motion', 'task', 'project:project_1', 'scheduling_issue']) });
  });
});
