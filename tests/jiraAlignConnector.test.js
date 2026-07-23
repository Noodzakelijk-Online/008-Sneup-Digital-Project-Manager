const { JiraAlignWorkSignalClient } = require('../src/services/jiraAlignWorkSignalClient');
const { getConnector } = require('../src/services/connectorRegistry');
const { buildConnectorSafetyProfile } = require('../src/services/connectorSafetyProfile');

describe('Jira Align connector', () => {
  const account = { metadata: { fields: { tenantUrl: 'https://acme.jiraalign.com' } } };
  const credentials = { getAccountCredentials: () => ({ apiToken: 'user:private-api-token' }) };

  test('uses a guarded tenant API-token connector with bounded portfolio and program sync', () => {
    const connector = getConnector('jira_align');
    const profile = buildConnectorSafetyProfile(connector);
    expect(connector).toMatchObject({ auth: { type: 'api_key' }, sync: ['portfolios', 'programs'] });
    expect(connector.auth.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tenantUrl', required: true }),
      expect.objectContaining({ name: 'apiToken', secret: true, required: true })
    ]));
    expect(profile).toMatchObject({ scopeReviewRequired: true, scopeRisk: 'guarded' });
  });

  test('reads one capped metadata page per resource without retaining descriptions, people, URLs, or token data', async () => {
    const http = { get: jest.fn().mockImplementation(url => Promise.resolve({ data: {
      value: url.endsWith('/Portfolios') ? [{ id: 1, title: 'Private private@example.test https://private.example portfolio', lastUpdatedDate: '2026-07-14T12:00:00.000Z', description: 'private description', owner: { email: 'private@example.test' }, customFields: [{ value: 'secret' }] }] : [{ id: 2, title: 'Delivery program', lastUpdatedDate: '2026-07-15T12:00:00.000Z', dependencyIds: [42], workItems: [{ title: 'secret' }], url: 'https://private.example/program' }]
    } })) };
    const client = new JiraAlignWorkSignalClient({ http, accountConnectorService: credentials });

    const result = await client.fetchDelta(account, '2026-07-10T00:00:00.000Z');

    expect(http.get).toHaveBeenCalledTimes(2);
    expect(http.get).toHaveBeenCalledWith('https://acme.jiraalign.com/rest/align/api/2/Portfolios', expect.objectContaining({
      params: { '$select': 'id,title,lastUpdatedDate', '$top': 100 },
      headers: expect.objectContaining({ Authorization: 'Bearer user:private-api-token' }), maxRedirects: 0, proxy: false
    }));
    expect(http.get).toHaveBeenCalledWith('https://acme.jiraalign.com/rest/align/api/2/Programs', expect.objectContaining({ params: { '$select': 'id,title,lastUpdatedDate', '$top': 250 } }));
    expect(result.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'jira_align_portfolio:1', sourceType: 'portfolio', name: 'Private [redacted email] [redacted url] portfolio' }),
      expect.objectContaining({ id: 'jira_align_program:2', sourceType: 'program', name: 'Delivery program' })
    ]));
    expect(result.metadata).toMatchObject({ portfolios: 1, programs: 1 });
    expect(JSON.stringify(result)).not.toMatch(/private description|private@example\.test|private\.example|secret|user:private-api-token/);
    expect(result.metadata.contentPolicy).toContain('no_expansion_descriptions_people_custom_fields');
  });

  test('fails closed for invalid tenant URLs, cursors, malformed data, provider pagination, and caps', async () => {
    const client = new JiraAlignWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: credentials });
    await expect(client.fetchDelta({ metadata: { fields: { tenantUrl: 'http://127.0.0.1' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta(account, 'invalid')).rejects.toMatchObject({ statusCode: 400 });

    const malformed = new JiraAlignWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: {} }) }, accountConnectorService: credentials });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });

    const paginated = new JiraAlignWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { value: [], '@odata.nextLink': 'https://private.example/next' } }) }, accountConnectorService: credentials });
    await expect(paginated.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 });

    const originalCap = process.env.SNEUP_JIRA_ALIGN_MAX_PORTFOLIOS;
    process.env.SNEUP_JIRA_ALIGN_MAX_PORTFOLIOS = '1';
    const capped = new JiraAlignWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: [{ id: 1, title: 'One' }, { id: 2, title: 'Two' }] }) }, accountConnectorService: credentials });
    try {
      await expect(capped.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 });
    } finally {
      if (originalCap === undefined) delete process.env.SNEUP_JIRA_ALIGN_MAX_PORTFOLIOS; else process.env.SNEUP_JIRA_ALIGN_MAX_PORTFOLIOS = originalCap;
    }
  });

  test('exposes a read-only adapter and normalizes only approved portfolio and program metadata', () => {
    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(workSignalAdapterService.getAdapter('jira_align').capabilities).toMatchObject({ credentialBackedSync: true, applyAction: false });
    const normalized = workSignalAdapterService.normalize({ connectorId: 'jira_align' }, { id: 'jira_align_program:2', jiraAlignId: '2', sourceType: 'program', name: 'Delivery program', updatedAt: '2026-07-15T12:00:00.000Z', description: 'private description', owner: { email: 'private@example.test' }, url: 'https://private.example/program', customFields: [{ value: 'secret' }] });
    expect(normalized).toMatchObject({ externalId: 'jira_align_program:2', sourceType: 'program', title: 'Delivery program', description: '', url: undefined, raw: { jiraAlignId: '2', sourceType: 'program' } });
    expect(JSON.stringify(normalized)).not.toMatch(/private description|private@example\.test|private\.example|secret/);
  });
});
