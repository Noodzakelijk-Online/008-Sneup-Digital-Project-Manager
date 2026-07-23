const { PaymoWorkSignalClient } = require('../src/services/paymoWorkSignalClient');
const { getConnector } = require('../src/services/connectorRegistry');
const { buildConnectorSafetyProfile } = require('../src/services/connectorSafetyProfile');

const account = { connectorId: 'paymo' };

describe('Paymo connector', () => {
  test('reads bounded active project and task metadata without retaining private provider fields', async () => {
    const http = { get: jest.fn()
      .mockResolvedValueOnce({ data: { projects: [{ id: 9, name: 'Launch owner@example.test https://private.example', active: true, description: 'Private plan', client_id: 12, budget_hours: 80, price_per_hour: 120, created_on: '2026-07-09T09:00:00.000Z', updated_on: '2026-07-10T10:00:00.000Z' }] } })
      .mockResolvedValueOnce({ data: { tasks: [{ id: 18, project_id: 9, name: 'Ship owner@example.test https://private.example/task', complete: true, priority: 100, description: 'Private task body', users: [12], billable: true, price_per_hour: 120, due_date: '2026-07-20', created_on: '2026-07-09T09:00:00.000Z', updated_on: '2026-07-11T09:00:00.000Z' }] } }) };
    const client = new PaymoWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: () => ({ apiKey: 'paymo-key' }) } });
    const result = await client.fetchDelta(account);

    expect(http.get).toHaveBeenNthCalledWith(1, 'https://app.paymoapp.com/api/projects', expect.objectContaining({ params: { where: 'active=true' }, headers: { Accept: 'application/json' }, auth: { username: 'paymo-key', password: 'SneupReadOnly' }, timeout: 15000, maxContentLength: 1000000, maxBodyLength: 1000000, maxRedirects: 0, proxy: false }));
    expect(http.get).toHaveBeenNthCalledWith(2, 'https://app.paymoapp.com/api/tasks', expect.objectContaining({ params: { where: 'project_id=9' } }));
    expect(http).not.toHaveProperty('post');
    expect(result).toMatchObject({ metadata: { source: 'paymo_api', projects: 1, tasks: 1 } });
    expect(result.records).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'project:9', name: 'Launch [redacted email] [redacted url]' }), expect.objectContaining({ id: 'task:18', projectId: '9', status: 'done', priority: 'critical' })]));
    expect(JSON.stringify(result.records)).not.toMatch(/Private plan|Private task body|owner@example\.test|private\.example|client_id|budget_hours|price_per_hour|users|billable/);
    expect(result.metadata.contentPolicy).toContain('no_descriptions_comments_files_people_billing_budget_rates_clients_time_entries_urls_or_provider_writes');
  });

  test('fails closed for invalid cursors, malformed data, and configured task caps', async () => {
    const credentials = { getAccountCredentials: () => ({ apiKey: 'paymo-key' }) };
    const client = new PaymoWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: credentials });
    await expect(client.fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });
    const malformed = new PaymoWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { projects: {} } }) }, accountConnectorService: credentials });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
    const capped = new PaymoWorkSignalClient({ http: { get: jest.fn()
      .mockResolvedValueOnce({ data: { projects: [{ id: 9, name: 'One' }] } })
      .mockResolvedValueOnce({ data: { tasks: [{ id: 18, project_id: 9, name: 'One' }, { id: 19, project_id: 9, name: 'Two' }] } }) }, accountConnectorService: credentials });
    const previous = process.env.SNEUP_PAYMO_MAX_TASKS; process.env.SNEUP_PAYMO_MAX_TASKS = '1';
    try { await expect(capped.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 }); } finally { if (previous === undefined) delete process.env.SNEUP_PAYMO_MAX_TASKS; else process.env.SNEUP_PAYMO_MAX_TASKS = previous; }
  });

  test('registers Paymo as an approval-gated, read-only live adapter', () => {
    const connector = getConnector('paymo');
    expect(connector.auth).toMatchObject({ type: 'api_key' });
    expect(buildConnectorSafetyProfile(connector)).toMatchObject({ scopeRisk: 'guarded', providerWritesBlocked: true });
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('paymo');
    expect(adapter).toMatchObject({ connectorId: 'paymo', capabilities: { credentialBackedSync: true, fetchDelta: true, applyAction: false } });
    expect(adapter.normalize(account, { id: 'task:18', sourceType: 'task', taskId: '18', projectId: '9', name: 'Ship', status: 'done', priority: 'critical' })).toMatchObject({ externalId: 'task:18', description: '', url: undefined, owners: [], labels: expect.arrayContaining(['paymo', 'task', 'project:9', 'done']), raw: { taskId: '18', priority: 'critical' } });
  });
});
