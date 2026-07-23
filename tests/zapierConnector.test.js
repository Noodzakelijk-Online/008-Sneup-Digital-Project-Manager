const axios = require('axios');
const accountConnectorService = require('../src/services/accountConnectorService');
const { ZapierWorkSignalClient } = require('../src/services/zapierWorkSignalClient');
const { getConnector } = require('../src/services/connectorRegistry');
const { buildConnectorSafetyProfile } = require('../src/services/connectorSafetyProfile');

describe('Zapier connector', () => {
  test('uses the narrow Zap inventory OAuth grant with guarded consent', async () => {
    const original = { state: process.env.CONNECTOR_STATE_SECRET, encryption: process.env.CONNECTOR_ENCRYPTION_KEY, clientId: process.env.ZAPIER_CLIENT_ID, clientSecret: process.env.ZAPIER_CLIENT_SECRET };
    process.env.CONNECTOR_STATE_SECRET = 'connector-state-secret-for-zapier-tests-123456';
    process.env.CONNECTOR_ENCRYPTION_KEY = 'connector-encryption-key-for-zapier-tests-123456';
    process.env.ZAPIER_CLIENT_ID = 'zapier-client-id';
    process.env.ZAPIER_CLIENT_SECRET = 'zapier-client-secret';
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'zapier-access-token', refresh_token: 'zapier-refresh-token', expires_in: 36000 } });

    try {
      const connector = getConnector('zapier');
      const profile = buildConnectorSafetyProfile(connector);
      expect(connector.auth).toMatchObject({ type: 'oauth2', scopes: ['zap:all'] });
      expect(profile).toMatchObject({ scopeReviewRequired: true, providerScopeReviewRequired: false, scopeRisk: 'guarded' });

      const connection = accountConnectorService.beginConnection('zapier', { baseUrl: 'https://sneup.example', scopeAcknowledged: true, actorId: 'operator-1' });
      expect(new URL(connection.authUrl)).toMatchObject({ hostname: 'api.zapier.com', pathname: '/v2/authorize' });
      await accountConnectorService.exchangeCodeForToken(connector, 'authorization-code', 'https://sneup.example');
      expect(post).toHaveBeenCalledWith('https://zapier.com/oauth/token/', expect.stringContaining('grant_type=authorization_code'), expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }) }));
    } finally {
      post.mockRestore();
      if (original.state === undefined) delete process.env.CONNECTOR_STATE_SECRET; else process.env.CONNECTOR_STATE_SECRET = original.state;
      if (original.encryption === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY; else process.env.CONNECTOR_ENCRYPTION_KEY = original.encryption;
      if (original.clientId === undefined) delete process.env.ZAPIER_CLIENT_ID; else process.env.ZAPIER_CLIENT_ID = original.clientId;
      if (original.clientSecret === undefined) delete process.env.ZAPIER_CLIENT_SECRET; else process.env.ZAPIER_CLIENT_SECRET = original.clientSecret;
    }
  });

  test('reads one bounded automation page without retaining steps, inputs, links, runs, or account data', async () => {
    const http = { get: jest.fn().mockResolvedValue({ data: {
      links: { next: null, prev: null },
      meta: { count: 1, offset: 0, limit: 100 },
      data: [{
        type: 'zap', id: 'zap-1', title: 'Client private@example.test https://private.example automation', is_enabled: true, updated_at: '2026-07-14T12:00:00.000Z', last_successful_run_date: '2026-07-13T12:00:00.000Z',
        links: { html_editor: 'https://zapier.com/editor/private' }, steps: [{ title: 'Private step', inputs: { api_key: 'secret' }, authentication: 'private-auth' }], runs: [{ payload: 'private run' }], owner: { email: 'private@example.test' }
      }]
    } }) };
    const client = new ZapierWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'zapier-token' }) } });

    const result = await client.fetchDelta({}, '2026-07-10T00:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith('https://api.zapier.com/v2/zaps', expect.objectContaining({
      params: { limit: 100, offset: 0, include_shared: false },
      headers: expect.objectContaining({ Authorization: 'Bearer zapier-token' }), maxRedirects: 0, proxy: false
    }));
    expect(result.records).toEqual([expect.objectContaining({ id: 'zapier_automation:zap-1', sourceType: 'automation', name: 'Client [redacted email] [redacted url] automation', status: 'active' })]);
    expect(result.metadata).toMatchObject({ workflows: 1 });
    expect(JSON.stringify(result)).not.toMatch(/Private step|secret|private-auth|private run|private@example\.test|private\.example|zapier-token/);
    expect(result.metadata.contentPolicy).toContain('no_steps_inputs_linked_authentications_editor_urls');
  });

  test('fails closed for invalid cursors, malformed collections, incomplete pages, and configured caps', async () => {
    const client = new ZapierWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'zapier-token' }) } });
    await expect(client.fetchDelta({}, 'invalid')).rejects.toMatchObject({ statusCode: 400 });

    const malformed = new ZapierWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: {} }) }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'zapier-token' }) } });
    await expect(malformed.fetchDelta({})).rejects.toMatchObject({ statusCode: 502 });

    const incomplete = new ZapierWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { links: { next: 'https://api.zapier.com/v2/zaps?offset=1' }, data: [] } }) }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'zapier-token' }) } });
    await expect(incomplete.fetchDelta({})).rejects.toMatchObject({ statusCode: 413 });

    const originalCap = process.env.SNEUP_ZAPIER_MAX_ZAPS;
    process.env.SNEUP_ZAPIER_MAX_ZAPS = '1';
    const capped = new ZapierWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { links: { next: null }, data: [{ id: 'zap-1', title: 'One', is_enabled: true }, { id: 'zap-2', title: 'Two', is_enabled: false }] } }) }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'zapier-token' }) } });
    try {
      await expect(capped.fetchDelta({})).rejects.toMatchObject({ statusCode: 413 });
    } finally {
      if (originalCap === undefined) delete process.env.SNEUP_ZAPIER_MAX_ZAPS; else process.env.SNEUP_ZAPIER_MAX_ZAPS = originalCap;
    }
  });

  test('exposes a read-only adapter and normalizes only approved automation metadata', () => {
    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(workSignalAdapterService.getAdapter('zapier').capabilities).toMatchObject({ credentialBackedSync: true, applyAction: false });
    const normalized = workSignalAdapterService.normalize({ connectorId: 'zapier' }, { id: 'zapier_automation:zap-1', zapId: 'zap-1', sourceType: 'automation', name: 'Client automation', status: 'active', updatedAt: '2026-07-14T12:00:00.000Z', steps: [{ inputs: { token: 'secret' } }], links: { html_editor: 'https://private.example/editor' }, owner: { email: 'private@example.test' } });
    expect(normalized).toMatchObject({ externalId: 'zapier_automation:zap-1', sourceType: 'automation', title: 'Client automation', description: '', url: undefined, raw: { zapId: 'zap-1', sourceType: 'automation', status: 'active' } });
    expect(JSON.stringify(normalized)).not.toMatch(/secret|private\.example|private@example\.test/);
  });
});
