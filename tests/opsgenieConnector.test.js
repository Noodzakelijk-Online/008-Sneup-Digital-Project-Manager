const { OpsgenieWorkSignalClient } = require('../src/services/opsgenieWorkSignalClient');
const { getConnector } = require('../src/services/connectorRegistry');
const { buildConnectorSafetyProfile } = require('../src/services/connectorSafetyProfile');

describe('Opsgenie connector', () => {
  const account = { metadata: { fields: { region: 'us' } } };
  const credentials = { getAccountCredentials: () => ({ apiKey: 'opsgenie-api-key' }) };

  test('reads one bounded open-alert collection and keeps private alert fields out of Sneup', async () => {
    const http = { get: jest.fn()
      .mockResolvedValueOnce({ data: { data: { count: 1 } } })
      .mockResolvedValueOnce({ data: { data: [{
        id: '1d4dbf43-7319-43ee-8d45-539262491d89',
        tinyId: '1791',
        message: 'Launch escalation email@example.test https://private.example/alert',
        status: 'open',
        priority: 'P2',
        count: 3,
        createdAt: '2026-07-22T08:00:00.000Z',
        updatedAt: '2026-07-22T09:00:00.000Z',
        lastOccurredAt: '2026-07-22T09:00:00.000Z',
        alias: 'Private customer escalation',
        description: 'Private incident narrative',
        responders: [{ name: 'Private responder' }],
        owner: 'private@example.test',
        teams: [{ name: 'Private team' }]
      }] } }) };
    const client = new OpsgenieWorkSignalClient({ http, accountConnectorService: credentials });

    const result = await client.fetchDelta(account, null);

    expect(http.get).toHaveBeenNthCalledWith(1, 'https://api.opsgenie.com/v2/alerts/count', expect.objectContaining({
      params: { query: 'status: open' },
      headers: expect.objectContaining({ Authorization: 'GenieKey opsgenie-api-key' }),
      maxContentLength: 2000000,
      maxBodyLength: 2000000,
      maxRedirects: 0,
      proxy: false
    }));
    expect(http.get).toHaveBeenNthCalledWith(2, 'https://api.opsgenie.com/v2/alerts', expect.objectContaining({
      params: { query: 'status: open', offset: 0, limit: 100, sort: 'updatedAt', order: 'desc' }
    }));
    expect(result.records).toEqual([expect.objectContaining({
      id: 'alert:1d4dbf43-7319-43ee-8d45-539262491d89',
      alertId: '1d4dbf43-7319-43ee-8d45-539262491d89',
      tinyId: '1791',
      name: 'Launch escalation [redacted email] [redacted url]',
      status: 'open',
      priority: 'P2',
      occurrenceCount: 3
    })]);
    expect(JSON.stringify(result)).not.toMatch(/Private customer|Private incident|Private responder|Private team|private\.example|opsgenie-api-key/);
    expect(result.metadata).toMatchObject({ source: 'opsgenie_api', region: 'us', openAlerts: 1 });
    expect(result.metadata.contentPolicy).toContain('no_descriptions_aliases_responders');
  });

  test('uses only the official EU endpoint when region is selected', async () => {
    const http = { get: jest.fn()
      .mockResolvedValueOnce({ data: { data: { count: 0 } } })
      .mockResolvedValueOnce({ data: { data: [] } }) };
    const client = new OpsgenieWorkSignalClient({ http, accountConnectorService: credentials });

    await client.fetchDelta({ metadata: { fields: { region: 'eu' } } }, null);

    expect(http.get).toHaveBeenNthCalledWith(1, 'https://api.eu.opsgenie.com/v2/alerts/count', expect.any(Object));
    expect(http.get).toHaveBeenNthCalledWith(2, 'https://api.eu.opsgenie.com/v2/alerts', expect.any(Object));
  });

  test('fails closed for invalid regions, cursors, counts, collections, and configured caps', async () => {
    const client = new OpsgenieWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: credentials });
    await expect(client.fetchDelta({ metadata: { fields: { region: 'https://private.example' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });

    const malformedCount = new OpsgenieWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { data: { count: 'bad' } } }) }, accountConnectorService: credentials });
    await expect(malformedCount.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });

    const malformedCollection = new OpsgenieWorkSignalClient({ http: { get: jest.fn()
      .mockResolvedValueOnce({ data: { data: { count: 1 } } })
      .mockResolvedValueOnce({ data: { data: [] } }) }, accountConnectorService: credentials });
    await expect(malformedCollection.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });

    const originalCap = process.env.SNEUP_OPSGENIE_MAX_ALERTS;
    process.env.SNEUP_OPSGENIE_MAX_ALERTS = '1';
    const capped = new OpsgenieWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { data: { count: 2 } } }) }, accountConnectorService: credentials });
    try {
      await expect(capped.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 });
    } finally {
      if (originalCap === undefined) delete process.env.SNEUP_OPSGENIE_MAX_ALERTS;
      else process.env.SNEUP_OPSGENIE_MAX_ALERTS = originalCap;
    }
  });

  test('exposes a guarded read-only catalog entry and adapter', () => {
    const connector = getConnector('opsgenie');
    const profile = buildConnectorSafetyProfile(connector);
    expect(connector).toMatchObject({ auth: { type: 'api_key' }, sync: ['open_alerts'] });
    expect(connector.description).toContain('provider writes');
    expect(profile).toMatchObject({ ingestion: 'read_only', providerWritesBlocked: true, scopeReviewRequired: true, scopeRisk: 'guarded' });

    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(workSignalAdapterService.getAdapter('opsgenie').capabilities).toMatchObject({ credentialBackedSync: true, applyAction: false });
    const normalized = workSignalAdapterService.normalize({ connectorId: 'opsgenie' }, {
      id: 'alert:1d4dbf43-7319-43ee-8d45-539262491d89',
      alertId: '1d4dbf43-7319-43ee-8d45-539262491d89',
      tinyId: '1791',
      name: 'Open delivery risk',
      status: 'open',
      priority: 'P1',
      occurrenceCount: 3,
      updatedAt: '2026-07-22T09:00:00.000Z',
      description: 'Private incident narrative',
      responders: [{ name: 'Private responder' }]
    });
    expect(normalized).toMatchObject({ externalId: 'alert:1d4dbf43-7319-43ee-8d45-539262491d89', sourceType: 'alert', title: 'Open delivery risk', priority: 'critical', description: '', raw: { alertId: '1d4dbf43-7319-43ee-8d45-539262491d89', occurrenceCount: 3 } });
    expect(JSON.stringify(normalized)).not.toMatch(/Private incident|Private responder/);
  });
});
