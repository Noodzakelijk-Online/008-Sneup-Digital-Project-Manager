const axios = require('axios');
const accountConnectorService = require('../src/services/accountConnectorService');
const { PowerBiWorkSignalClient } = require('../src/services/powerBiWorkSignalClient');
const { getConnector } = require('../src/services/connectorRegistry');
const { buildConnectorSafetyProfile } = require('../src/services/connectorSafetyProfile');

describe('Power BI connector', () => {
  test('uses the narrow report-read OAuth grant and requires scope review', async () => {
    const original = { state: process.env.CONNECTOR_STATE_SECRET, encryption: process.env.CONNECTOR_ENCRYPTION_KEY, clientId: process.env.POWER_BI_CLIENT_ID, clientSecret: process.env.POWER_BI_CLIENT_SECRET };
    process.env.CONNECTOR_STATE_SECRET = 'connector-state-secret-for-power-bi-tests-123456';
    process.env.CONNECTOR_ENCRYPTION_KEY = 'connector-encryption-key-for-power-bi-tests-123456';
    process.env.POWER_BI_CLIENT_ID = 'power-bi-client-id';
    process.env.POWER_BI_CLIENT_SECRET = 'power-bi-client-secret';
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'power-bi-access-token' } });

    try {
      const connector = getConnector('power_bi');
      const profile = buildConnectorSafetyProfile(connector);
      expect(connector.auth).toMatchObject({ type: 'oauth2', scopes: ['offline_access', 'https://analysis.windows.net/powerbi/api/Report.Read.All'] });
      expect(profile).toMatchObject({ scopeReviewRequired: true, providerScopeReviewRequired: true, scopeRisk: 'review' });

      const connection = accountConnectorService.beginConnection('power_bi', { baseUrl: 'https://sneup.example', scopeAcknowledged: true, actorId: 'operator-1' });
      expect(new URL(connection.authUrl)).toMatchObject({ hostname: 'login.microsoftonline.com', pathname: '/common/oauth2/v2.0/authorize' });
      await accountConnectorService.exchangeCodeForToken(connector, 'authorization-code', 'https://sneup.example');
      expect(post).toHaveBeenCalledWith('https://login.microsoftonline.com/common/oauth2/v2.0/token', expect.stringContaining('grant_type=authorization_code'), expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }) }));
    } finally {
      post.mockRestore();
      if (original.state === undefined) delete process.env.CONNECTOR_STATE_SECRET; else process.env.CONNECTOR_STATE_SECRET = original.state;
      if (original.encryption === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY; else process.env.CONNECTOR_ENCRYPTION_KEY = original.encryption;
      if (original.clientId === undefined) delete process.env.POWER_BI_CLIENT_ID; else process.env.POWER_BI_CLIENT_ID = original.clientId;
      if (original.clientSecret === undefined) delete process.env.POWER_BI_CLIENT_SECRET; else process.env.POWER_BI_CLIENT_SECRET = original.clientSecret;
    }
  });

  test('reads one bounded report catalog without retaining report content, data, URLs, or user details', async () => {
    const http = { get: jest.fn().mockResolvedValue({ data: { value: [{
      id: '5b218778-e7a5-4d73-8187-f10824047715', name: 'Client email@example.test https://private.example dashboard', reportType: 'PowerBIReport', datasetId: 'cfafbeb1-8037-4d0c-896e-a46fb27ff229', webUrl: 'https://app.powerbi.com/reports/private', embedUrl: 'https://app.powerbi.com/reportEmbed?secret', description: 'Private report content', users: [{ emailAddress: 'private@example.test' }], subscriptions: [{ title: 'Private users' }]
    }] } }) };
    const client = new PowerBiWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'power-bi-token' }) } });

    const result = await client.fetchDelta({}, null);

    expect(http.get).toHaveBeenCalledWith('https://api.powerbi.com/v1.0/myorg/reports', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer power-bi-token' }), maxRedirects: 0, proxy: false }));
    expect(result.records).toEqual([expect.objectContaining({ id: 'power_bi_report:5b218778-e7a5-4d73-8187-f10824047715', reportId: '5b218778-e7a5-4d73-8187-f10824047715', reportType: 'PowerBIReport', status: 'open' })]);
    expect(JSON.stringify(result)).not.toMatch(/cfafbeb1|private\.example|reportEmbed|Private report content|Private users|power-bi-token/);
    expect(result.records[0].name).toContain('[redacted email]');
    expect(result.metadata.contentPolicy).toContain('no_report_content_dashboards_datasets');
  });

  test('fails closed for an invalid cursor, malformed provider collection, or report cap', async () => {
    const client = new PowerBiWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'power-bi-token' }) } });
    await expect(client.fetchDelta({}, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });

    const malformed = new PowerBiWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: {} }) }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'power-bi-token' }) } });
    await expect(malformed.fetchDelta({})).rejects.toMatchObject({ statusCode: 502 });

    const originalCap = process.env.SNEUP_POWER_BI_MAX_REPORTS;
    process.env.SNEUP_POWER_BI_MAX_REPORTS = '1';
    const capped = new PowerBiWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { value: [{ id: 'one' }, { id: 'two' }] } }) }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'power-bi-token' }) } });
    try {
      await expect(capped.fetchDelta({})).rejects.toMatchObject({ statusCode: 413 });
    } finally {
      if (originalCap === undefined) delete process.env.SNEUP_POWER_BI_MAX_REPORTS;
      else process.env.SNEUP_POWER_BI_MAX_REPORTS = originalCap;
    }
  });

  test('exposes a read-only adapter and normalizes only approved report metadata', () => {
    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(workSignalAdapterService.getAdapter('power_bi').capabilities).toMatchObject({ credentialBackedSync: true, applyAction: false });
    const normalized = workSignalAdapterService.normalize({ connectorId: 'power_bi' }, { id: 'power_bi_report:report-42', reportId: 'report-42', name: 'Project status', reportType: 'PowerBIReport', datasetId: 'private-dataset', webUrl: 'https://private.example/report' });
    expect(normalized).toMatchObject({ externalId: 'power_bi_report:report-42', sourceType: 'report', title: 'Project status', description: '', url: undefined, raw: { reportId: 'report-42', reportType: 'PowerBIReport' } });
    expect(JSON.stringify(normalized)).not.toMatch(/private-dataset|private\.example/);
  });
});
