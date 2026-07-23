const { TimeneyeWorkSignalClient } = require('../src/services/timeneyeWorkSignalClient');
const { getConnector } = require('../src/services/connectorRegistry');
const { buildConnectorSafetyProfile } = require('../src/services/connectorSafetyProfile');

describe('Lucen Track (Timeneye) connector', () => {
  test('reads only one selected member\'s bounded time-entry metadata', async () => {
    const http = { get: jest.fn().mockResolvedValue({ data: { data: [{
      entry_id: 71, user_id: 42, project_id: 12, phase_id: 4, todo_id: 8, entry_date: '2026-07-12', entry_minutes: 90,
      created_date: '2026-07-12T10:00:00.000Z', updated_date: '2026-07-12T11:00:00.000Z', notes: 'Private client meeting', client_id: 99,
      cost: '200', revenue: '300', profit: '100', billed: 1, source_url: 'https://private.example/source', source_text: 'Private source'
    }], meta: { current_page: 1, last_page: 1, total: 1 } } }) };
    const client = new TimeneyeWorkSignalClient({ http, now: () => new Date('2026-07-12T12:00:00.000Z'), accountConnectorService: { getAccountCredentials: () => ({ token: 'lucen-token' }) } });
    const result = await client.fetchDelta({ metadata: { fields: { memberId: '42' } } }, '2026-07-12T00:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith('https://api.timeneye.com/api/v1/entries', expect.objectContaining({
      params: expect.objectContaining({ page: 1, per_page: 100, sort_by: 'updated_date', direction: 'desc', 'member_ids[]': '42', date_from: '2026-07-11', date_to: '2026-07-12' }),
      headers: expect.objectContaining({ Authorization: 'Bearer lucen-token' }), maxContentLength: 1000000, maxBodyLength: 1000000, maxRedirects: 0, proxy: false
    }));
    expect(result).toMatchObject({ metadata: { source: 'lucen_track_timeneye_api', memberId: '42', timeEntries: 1 }, nextCursor: '2026-07-12T11:00:00.000Z' });
    expect(result.records).toEqual([expect.objectContaining({ id: 'time_entry:71', userId: '42', projectId: '12', phaseId: '4', todoId: '8', spentDate: '2026-07-12', hours: 1.5 })]);
    expect(JSON.stringify(result.records)).not.toMatch(/Private client meeting|private\.example|lucen-token|cost|revenue|profit|billed/);
    expect(result.metadata.contentPolicy).toContain('no_notes_clients_cost_revenue_profit_billing');
  });

  test('fails closed for invalid member IDs, cursors, and incomplete pages', async () => {
    const client = new TimeneyeWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: { getAccountCredentials: () => ({ token: 'lucen-token' }) } });
    await expect(client.fetchDelta({ metadata: { fields: { memberId: 'invalid/id' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta({ metadata: { fields: { memberId: '42' } } }, 'invalid')).rejects.toMatchObject({ statusCode: 400 });
    const capped = new TimeneyeWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { data: [{ entry_id: 1, entry_minutes: 60, entry_date: '2026-07-12' }], meta: { current_page: 1, last_page: 2, total: 2 } } }) }, accountConnectorService: { getAccountCredentials: () => ({ token: 'lucen-token' }) } });
    const previous = process.env.SNEUP_TIMENEYE_MAX_ENTRIES; process.env.SNEUP_TIMENEYE_MAX_ENTRIES = '1';
    try { await expect(capped.fetchDelta({ metadata: { fields: { memberId: '42' } } })).rejects.toMatchObject({ statusCode: 413 }); } finally { if (previous === undefined) delete process.env.SNEUP_TIMENEYE_MAX_ENTRIES; else process.env.SNEUP_TIMENEYE_MAX_ENTRIES = previous; }
  });

  test('exposes a read-only adapter and supports only explicit capacity mappings', () => {
    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    const connector = getConnector('timeneye');
    expect(connector.auth).toMatchObject({ type: 'personal_access_token', fields: expect.arrayContaining([expect.objectContaining({ name: 'memberId' })]) });
    expect(buildConnectorSafetyProfile(connector)).toMatchObject({ scopeReviewRequired: true, scopeRisk: 'guarded', providerWritesBlocked: true });
    expect(workSignalAdapterService.getAdapter('timeneye').capabilities).toMatchObject({ credentialBackedSync: true, applyAction: false });
    const normalized = workSignalAdapterService.normalize({ connectorId: 'timeneye' }, { id: 'time_entry:71', timeEntryId: '71', userId: '42', projectId: '12', spentDate: '2026-07-12', hours: 1.5, notes: 'Private note', source_url: 'https://private.example' });
    expect(normalized).toMatchObject({ externalId: 'time_entry:71', sourceType: 'time_entry', title: 'Lucen Track entry 71', description: '', owners: [], raw: { userId: '42', projectId: '12', spentDate: '2026-07-12', hours: 1.5 } });
    expect(JSON.stringify(normalized)).not.toMatch(/Private note|private\.example/);
  });
});
