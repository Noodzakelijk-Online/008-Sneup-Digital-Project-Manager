const { GanttProWorkSignalClient } = require('../src/services/ganttProWorkSignalClient');
const { getConnector } = require('../src/services/connectorRegistry');
const { buildConnectorSafetyProfile } = require('../src/services/connectorSafetyProfile');

const account = { connectorId: 'ganttpro' };

describe('GanttPRO connector', () => {
  test('reads bounded project and task metadata without retaining private provider fields', async () => {
    const http = { get: jest.fn()
      .mockResolvedValueOnce({ data: [{ projectId: 9, name: 'Launch owner@example.test https://private.example', lastUpdate: '2026-07-10T10:00:00.000Z', description: 'Private plan' }] })
      .mockResolvedValueOnce({ data: [{ id: 18, projectId: 9, name: 'Ship owner@example.test https://private.example/task', description: 'Private task body', status: 3, priority: 7, progress: 100, startDate: '2026-07-11T09:00:00.000Z', deadline: '2026-07-20T12:00:00.000Z', createdAt: '2026-07-09T09:00:00.000Z', resources: [{ owner: 'Private owner' }], comments: [{ text: 'Private comment' }], attachments: [{ url: 'https://private.example/file' }], customColumns: { secret: 'value' } }] }) };
    const client = new GanttProWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: () => ({ apiKey: 'ganttpro-key' }) } });
    const result = await client.fetchDelta(account);

    expect(http.get).toHaveBeenNthCalledWith(1, 'https://api.ganttpro.com/v1.0/projects', expect.objectContaining({ headers: expect.objectContaining({ 'X-API-Key': 'ganttpro-key' }), timeout: 15000, maxContentLength: 1000000, maxBodyLength: 1000000, maxRedirects: 0, proxy: false }));
    expect(http.get).toHaveBeenNthCalledWith(2, 'https://api.ganttpro.com/v1.0/tasks', expect.objectContaining({ params: { projectId: '9' } }));
    expect(http).not.toHaveProperty('post');
    expect(result).toMatchObject({ metadata: { source: 'ganttpro_api', projects: 1, tasks: 1 } });
    expect(result.records).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'project:9', name: 'Launch [redacted email] [redacted url]' }), expect.objectContaining({ id: 'task:18', projectId: '9', status: 'done', progressPercent: 100 })]));
    expect(JSON.stringify(result.records)).not.toMatch(/Private plan|Private task body|Private owner|Private comment|owner@example\.test|private\.example|customColumns|resources|attachments/);
    expect(result.metadata.contentPolicy).toContain('no_descriptions_comments_files_people_resources_links_custom_fields_or_provider_writes');
  });

  test('fails closed for invalid cursors, malformed data, and configured task caps', async () => {
    const credentials = { getAccountCredentials: () => ({ apiKey: 'ganttpro-key' }) };
    const client = new GanttProWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: credentials });
    await expect(client.fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });
    const malformed = new GanttProWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { items: [] } }) }, accountConnectorService: credentials });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
    const capped = new GanttProWorkSignalClient({ http: { get: jest.fn()
      .mockResolvedValueOnce({ data: [{ projectId: 9, name: 'One' }] })
      .mockResolvedValueOnce({ data: [{ id: 18, projectId: 9, name: 'One' }, { id: 19, projectId: 9, name: 'Two' }] }) }, accountConnectorService: credentials });
    const previous = process.env.SNEUP_GANTTPRO_MAX_TASKS; process.env.SNEUP_GANTTPRO_MAX_TASKS = '1';
    try { await expect(capped.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 }); } finally { if (previous === undefined) delete process.env.SNEUP_GANTTPRO_MAX_TASKS; else process.env.SNEUP_GANTTPRO_MAX_TASKS = previous; }
  });

  test('registers GanttPRO as an approval-gated, read-only live adapter', () => {
    const connector = getConnector('ganttpro');
    expect(connector.auth).toMatchObject({ type: 'api_key' });
    expect(buildConnectorSafetyProfile(connector)).toMatchObject({ scopeRisk: 'guarded', providerWritesBlocked: true });
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('ganttpro');
    expect(adapter).toMatchObject({ connectorId: 'ganttpro', capabilities: { credentialBackedSync: true, fetchDelta: true, applyAction: false } });
    expect(adapter.normalize(account, { id: 'task:18', sourceType: 'task', taskId: '18', projectId: '9', name: 'Ship', status: 'done', progressPercent: 100 })).toMatchObject({ externalId: 'task:18', description: '', url: undefined, owners: [], labels: expect.arrayContaining(['ganttpro', 'task', 'project:9', 'done']), raw: { taskId: '18', progressPercent: 100 } });
  });
});
