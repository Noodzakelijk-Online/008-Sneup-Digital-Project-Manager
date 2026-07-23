const axios = require('axios');
const accountConnectorService = require('../src/services/accountConnectorService');
const { DataStudioWorkSignalClient } = require('../src/services/dataStudioWorkSignalClient');
const { getConnector } = require('../src/services/connectorRegistry');
const { buildConnectorSafetyProfile } = require('../src/services/connectorSafetyProfile');

describe('Data Studio connector', () => {
  test('uses the narrow read-only OAuth grant with guarded consent', async () => {
    const original = { state: process.env.CONNECTOR_STATE_SECRET, encryption: process.env.CONNECTOR_ENCRYPTION_KEY, clientId: process.env.DATA_STUDIO_CLIENT_ID, clientSecret: process.env.DATA_STUDIO_CLIENT_SECRET };
    process.env.CONNECTOR_STATE_SECRET = 'connector-state-secret-for-data-studio-tests-123456';
    process.env.CONNECTOR_ENCRYPTION_KEY = 'connector-encryption-key-for-data-studio-tests-123456';
    process.env.DATA_STUDIO_CLIENT_ID = 'data-studio-client-id';
    process.env.DATA_STUDIO_CLIENT_SECRET = 'data-studio-client-secret';
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'data-studio-access-token' } });

    try {
      const connector = getConnector('looker_studio');
      const profile = buildConnectorSafetyProfile(connector);
      expect(connector.auth).toMatchObject({ type: 'oauth2', scopes: ['https://www.googleapis.com/auth/datastudio.readonly'] });
      expect(profile).toMatchObject({ scopeReviewRequired: true, providerScopeReviewRequired: false, scopeRisk: 'guarded' });

      const connection = accountConnectorService.beginConnection('looker_studio', { baseUrl: 'https://sneup.example', scopeAcknowledged: true, actorId: 'operator-1' });
      expect(new URL(connection.authUrl)).toMatchObject({ hostname: 'accounts.google.com', pathname: '/o/oauth2/v2/auth' });
      await accountConnectorService.exchangeCodeForToken(connector, 'authorization-code', 'https://sneup.example');
      expect(post).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', expect.stringContaining('grant_type=authorization_code'), expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }) }));
    } finally {
      post.mockRestore();
      if (original.state === undefined) delete process.env.CONNECTOR_STATE_SECRET; else process.env.CONNECTOR_STATE_SECRET = original.state;
      if (original.encryption === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY; else process.env.CONNECTOR_ENCRYPTION_KEY = original.encryption;
      if (original.clientId === undefined) delete process.env.DATA_STUDIO_CLIENT_ID; else process.env.DATA_STUDIO_CLIENT_ID = original.clientId;
      if (original.clientSecret === undefined) delete process.env.DATA_STUDIO_CLIENT_SECRET; else process.env.DATA_STUDIO_CLIENT_SECRET = original.clientSecret;
    }
  });

  test('reads one bounded page per asset type without retaining descriptions, identity fields, URLs, or configuration', async () => {
    const http = {
      get: jest.fn().mockImplementation((_url, request) => Promise.resolve({ data: request.params.assetTypes === 'REPORT' ? {
        assets: [{
          name: 'report-1', title: 'Executive private@example.test https://private.example/report dashboard', assetType: 'REPORT', createTime: '2026-07-10T10:00:00.000Z', updateTime: '2026-07-14T12:00:00.000Z',
          description: 'Private report description', owner: 'private@example.test', creator: 'private@example.test', reportUrl: 'https://private.example/report', filters: [{ name: 'secret' }], sections: [{ name: 'secret' }], permissions: [{ id: 'private' }]
        }]
      } : {
        assets: [{
          name: 'source-1', title: 'Delivery source', assetType: 'DATA_SOURCE', createTime: '2026-07-11T10:00:00.000Z', updateTime: '2026-07-15T12:00:00.000Z',
          description: 'Private source configuration', owner: 'private@example.test', configuration: { credentials: 'private' }
        }]
      } }))
    };
    const client = new DataStudioWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'data-studio-token' }) } });

    const result = await client.fetchDelta({}, '2026-07-10T00:00:00.000Z');

    expect(http.get).toHaveBeenCalledTimes(2);
    expect(http.get).toHaveBeenCalledWith('https://datastudio.googleapis.com/v1/assets:search', expect.objectContaining({
      params: { assetTypes: 'REPORT', pageSize: 100, includeTrashed: false, orderBy: 'id' },
      headers: expect.objectContaining({ Authorization: 'Bearer data-studio-token' }), maxRedirects: 0, proxy: false
    }));
    expect(http.get).toHaveBeenCalledWith('https://datastudio.googleapis.com/v1/assets:search', expect.objectContaining({ params: { assetTypes: 'DATA_SOURCE', pageSize: 100, includeTrashed: false, orderBy: 'id' } }));
    expect(result.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'data_studio_report:report-1', sourceType: 'report', name: 'Executive [redacted email] [redacted url] dashboard' }),
      expect.objectContaining({ id: 'data_studio_data_source:source-1', sourceType: 'data_source', name: 'Delivery source' })
    ]));
    expect(result.metadata).toMatchObject({ reports: 1, dataSources: 1 });
    expect(JSON.stringify(result)).not.toMatch(/Private report description|Private source configuration|private@example\.test|private\.example|secret|data-studio-token/);
    expect(result.metadata.contentPolicy).toContain('no_descriptions_owners_creators_urls_filters');
  });

  test('fails closed for invalid cursors, malformed collections, and incomplete asset pages', async () => {
    const client = new DataStudioWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'data-studio-token' }) } });
    await expect(client.fetchDelta({}, 'invalid')).rejects.toMatchObject({ statusCode: 400 });

    const malformed = new DataStudioWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: {} }) }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'data-studio-token' }) } });
    await expect(malformed.fetchDelta({})).rejects.toMatchObject({ statusCode: 502 });

    const incomplete = new DataStudioWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { assets: [], nextPageToken: 'next' } }) }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'data-studio-token' }) } });
    await expect(incomplete.fetchDelta({})).rejects.toMatchObject({ statusCode: 413 });
  });

  test('exposes a read-only adapter and normalizes only approved asset metadata', () => {
    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(workSignalAdapterService.getAdapter('looker_studio').capabilities).toMatchObject({ credentialBackedSync: true, applyAction: false });
    const normalized = workSignalAdapterService.normalize({ connectorId: 'looker_studio' }, { id: 'data_studio_report:report-1', assetId: 'report-1', sourceType: 'report', name: 'Client dashboard', status: 'open', createdAt: '2026-07-10T10:00:00.000Z', updatedAt: '2026-07-14T12:00:00.000Z', description: 'Private report', owner: 'private@example.test', url: 'https://private.example/report' });
    expect(normalized).toMatchObject({ externalId: 'data_studio_report:report-1', sourceType: 'report', title: 'Client dashboard', description: '', url: undefined, raw: { assetId: 'report-1', sourceType: 'report', status: 'open' } });
    expect(JSON.stringify(normalized)).not.toMatch(/Private report|private@example\.test|private\.example/);
  });
});
