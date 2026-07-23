const { AirtableWorkSignalClient } = require('../src/services/airtableWorkSignalClient');

describe('Airtable connector', () => {
  const account = {
    connectorId: 'airtable',
    metadata: { fields: { baseId: 'app123', tableName: 'Tasks', fieldNames: 'Task, Status, Priority, Owner, Due' } }
  };
  const credentials = { getAccountCredentials: () => ({ token: 'airtable-token' }) };

  test('uses allowlisted bounded reads and retains redacted task metadata only', async () => {
    const http = { get: jest.fn().mockResolvedValue({ data: { records: [{
      id: 'rec123',
      createdTime: '2026-07-10T08:00:00.000Z',
      fields: {
        Task: 'Ship owner@example.test https://private.example/task',
        Status: 'In Progress',
        Priority: 'High',
        Owner: 'owner@example.test',
        Due: '2026-07-15',
        PrivateNotes: 'Do not retain this.'
      }
    }] } }) };
    const client = new AirtableWorkSignalClient({ http, accountConnectorService: credentials });

    const result = await client.fetchDelta(account, null);

    expect(http.get).toHaveBeenCalledWith('https://api.airtable.com/v0/app123/Tasks', expect.objectContaining({
      params: expect.objectContaining({ 'fields[]': ['Task', 'Status', 'Priority', 'Owner', 'Due'], pageSize: 100 }),
      headers: expect.objectContaining({ Authorization: 'Bearer airtable-token' }),
      maxContentLength: 1000000,
      maxBodyLength: 1000000,
      maxRedirects: 0,
      proxy: false
    }));
    expect(http).not.toHaveProperty('post');
    expect(result.records).toEqual([expect.objectContaining({
      title: 'Ship [redacted email] [redacted url]',
      owners: ['[redacted email]']
    })]);
    expect(result.metadata.contentPolicy).toContain('explicit_allowlisted_fields_only');
    expect(JSON.stringify(result)).not.toMatch(/Do not retain|private\.example|owner@example\.test|airtable-token/);
  });

  test('fails closed for malformed records, cursor loops, and response configuration limits', async () => {
    const malformed = new AirtableWorkSignalClient({
      http: { get: jest.fn().mockResolvedValue({ data: { records: [{ id: 'not-a-record-id', fields: { Task: 'Ship' } }] } }) },
      accountConnectorService: credentials
    });
    await expect(malformed.fetchDelta(account, null)).rejects.toMatchObject({ statusCode: 502 });

    const looped = new AirtableWorkSignalClient({
      http: { get: jest.fn()
        .mockResolvedValueOnce({ data: { records: [{ id: 'rec123', fields: { Task: 'First' } }], offset: 'next-page' } })
        .mockResolvedValueOnce({ data: { records: [{ id: 'rec456', fields: { Task: 'Second' } }], offset: 'next-page' } }) },
      accountConnectorService: credentials
    });
    await expect(looped.fetchDelta(account, null)).rejects.toMatchObject({ statusCode: 502 });

    const originalLimit = process.env.SNEUP_AIRTABLE_MAX_RESPONSE_BYTES;
    process.env.SNEUP_AIRTABLE_MAX_RESPONSE_BYTES = '1';
    try {
      expect(malformed.getConfig(account).maxResponseBytes).toBe(1024);
    } finally {
      if (originalLimit === undefined) delete process.env.SNEUP_AIRTABLE_MAX_RESPONSE_BYTES;
      else process.env.SNEUP_AIRTABLE_MAX_RESPONSE_BYTES = originalLimit;
    }
  });

  test('keeps Airtable adapter evidence URL-free and raw fields allowlisted', () => {
    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const adapter = workSignalAdapterService.getAdapter('airtable');
    expect(adapter.capabilities).toMatchObject({ credentialBackedSync: true, applyAction: false });
    const normalized = adapter.normalize(account, {
      id: 'rec123', externalId: 'base:app123:table:Tasks:record:rec123', title: 'Ship release', status: 'In Progress', priority: 'High',
      owners: ['Robert'], dueAt: '2026-07-15', createdTime: '2026-07-10T08:00:00.000Z', url: 'https://private.example/record',
      base: { id: 'app123', name: 'app123', url: 'https://private.example/base' },
      table: { name: 'Tasks', description: 'Private table description' },
      privateNotes: 'Private field value'
    });
    expect(normalized).toMatchObject({ externalId: 'base:app123:table:Tasks:record:rec123', title: 'Ship release', description: '', evidenceRefs: [{ externalId: 'base:app123:table:Tasks:record:rec123' }] });
    expect(normalized.evidenceRefs[0]).not.toHaveProperty('url');
    expect(JSON.stringify(normalized)).not.toMatch(/private\.example|Private table description|Private field value/);
  });
});
