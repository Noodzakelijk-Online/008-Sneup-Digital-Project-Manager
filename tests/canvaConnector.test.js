const crypto = require('crypto');
const axios = require('axios');
const accountConnectorService = require('../src/services/accountConnectorService');
const { CanvaWorkSignalClient } = require('../src/services/canvaWorkSignalClient');
const { getConnector } = require('../src/services/connectorRegistry');
const { buildConnectorSafetyProfile } = require('../src/services/connectorSafetyProfile');

describe('Canva connector', () => {
  test('uses encrypted PKCE state with the metadata-only Canva OAuth scope', async () => {
    const original = {
      state: process.env.CONNECTOR_STATE_SECRET,
      clientId: process.env.CANVA_CLIENT_ID,
      clientSecret: process.env.CANVA_CLIENT_SECRET
    };
    process.env.CONNECTOR_STATE_SECRET = 'connector-state-secret-for-canva-pkce-tests-123456';
    process.env.CANVA_CLIENT_ID = 'canva-client-id';
    process.env.CANVA_CLIENT_SECRET = 'canva-client-secret';
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'canva-access-token' } });

    try {
      const connector = getConnector('canva');
      const profile = buildConnectorSafetyProfile(connector);
      expect(connector.auth).toMatchObject({ type: 'oauth2', tokenAuth: 'basic', pkce: true, scopes: ['design:meta:read'] });
      expect(profile).toMatchObject({ scopeReviewRequired: true, providerScopeReviewRequired: false, scopeRisk: 'guarded' });

      const connection = accountConnectorService.beginConnection('canva', { baseUrl: 'https://sneup.example', scopeAcknowledged: true, actorId: 'operator-1' });
      const url = new URL(connection.authUrl);
      const payload = JSON.parse(Buffer.from(url.searchParams.get('state').split('.')[0], 'base64url').toString('utf8'));
      const verifier = accountConnectorService.decryptStateValue(payload.pkce);
      expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBe(crypto.createHash('sha256').update(verifier).digest('base64url'));
      expect(connection.authUrl).not.toContain(verifier);
      expect(JSON.stringify(payload)).not.toContain(verifier);

      await accountConnectorService.exchangeCodeForToken(connector, 'authorization-code', 'https://sneup.example', verifier);
      expect(post).toHaveBeenCalledWith('https://api.canva.com/rest/v1/oauth/token', expect.stringContaining('code_verifier='), expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Basic ${Buffer.from('canva-client-id:canva-client-secret').toString('base64')}` })
      }));
      expect(post.mock.calls[0][1]).toContain('grant_type=authorization_code');
    } finally {
      post.mockRestore();
      if (original.state === undefined) delete process.env.CONNECTOR_STATE_SECRET; else process.env.CONNECTOR_STATE_SECRET = original.state;
      if (original.clientId === undefined) delete process.env.CANVA_CLIENT_ID; else process.env.CANVA_CLIENT_ID = original.clientId;
      if (original.clientSecret === undefined) delete process.env.CANVA_CLIENT_SECRET; else process.env.CANVA_CLIENT_SECRET = original.clientSecret;
    }
  });

  test('reads one bounded design metadata page without content, links, thumbnails, owners, or assets', async () => {
    const http = { get: jest.fn().mockResolvedValue({ data: { items: [{
      id: 'DAGuX_Cv-9', title: 'Launch private@example.test https://private.example/design', created_at: 1721000000, updated_at: 1721100000,
      owner: { user_id: 'private-user', team_id: 'private-team' }, thumbnail: { url: 'https://private.example/thumb' }, urls: { edit_url: 'https://private.example/edit' }, page_count: 7, content: 'Private design content'
    }] } }) };
    const client = new CanvaWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'canva-token' }) } });
    const result = await client.fetchDelta({}, '2024-07-13T00:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith('https://api.canva.com/rest/v1/designs', expect.objectContaining({
      params: { limit: 100, ownership: 'any', sort_by: 'modified_descending' }, headers: expect.objectContaining({ Authorization: 'Bearer canva-token' }),
      maxContentLength: 2000000, maxBodyLength: 2000000, maxRedirects: 0, proxy: false
    }));
    expect(result.records).toEqual([expect.objectContaining({ id: 'canva:DAGuX_Cv-9', sourceType: 'design', designId: 'DAGuX_Cv-9', name: 'Launch [redacted email] [redacted url]' })]);
    expect(JSON.stringify(result)).not.toMatch(/Private design content|private@example\.test|private\.example|private-user|private-team|canva-token/);
    expect(result.metadata.contentPolicy).toContain('no_design_content_pages_thumbnails_temporary_links');
  });

  test('fails closed for invalid cursors and incomplete design pages', async () => {
    const client = new CanvaWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'canva-token' }) } });
    await expect(client.fetchDelta({}, 'invalid')).rejects.toMatchObject({ statusCode: 400 });
    const capped = new CanvaWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { items: [{ id: 'design-1', title: 'One' }], continuation: 'next' } }) }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'canva-token' }) } });
    await expect(capped.fetchDelta({})).rejects.toMatchObject({ statusCode: 413 });
  });

  test('exposes a read-only adapter and normalizes only approved design metadata', () => {
    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(workSignalAdapterService.getAdapter('canva').capabilities).toMatchObject({ credentialBackedSync: true, applyAction: false });
    const normalized = workSignalAdapterService.normalize({ connectorId: 'canva' }, { id: 'canva:design-1', designId: 'design-1', name: 'Launch design', status: 'open', updatedAt: '2026-07-14T12:00:00.000Z', content: 'Private design content', urls: { edit_url: 'https://private.example/edit' }, owner: { user_id: 'private-user' } });
    expect(normalized).toMatchObject({ externalId: 'canva:design-1', sourceType: 'design', title: 'Launch design', description: '', url: undefined, raw: { designId: 'design-1', status: 'open' } });
    expect(JSON.stringify(normalized)).not.toMatch(/Private design content|private\.example|private-user/);
  });
});
