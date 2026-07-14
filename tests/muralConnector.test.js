const accountConnectorService = require('../src/services/accountConnectorService');
const { MuralWorkSignalClient } = require('../src/services/muralWorkSignalClient');
const { getConnector } = require('../src/services/connectorRegistry');
const { buildConnectorSafetyProfile } = require('../src/services/connectorSafetyProfile');

describe('Mural connector', () => {
  test('uses bounded read-only workspace and mural scopes', () => {
    const connector = getConnector('mural');
    const profile = buildConnectorSafetyProfile(connector);
    expect(connector.auth).toMatchObject({ type: 'oauth2', scopes: ['workspaces:read', 'murals:read'] });
    expect(profile).toMatchObject({ scopeReviewRequired: true, providerScopeReviewRequired: false, scopeRisk: 'guarded' });
  });

  test('reads one active-mural metadata page without content, people, URLs, or comments', async () => {
    const http = { get: jest.fn().mockResolvedValue({ data: { value: [{
      id: 'workspace_123.456', title: 'Delivery private@example.test https://private.example/mural', createdAt: '2026-07-10T10:00:00.000Z', lastModified: '2026-07-14T12:00:00.000Z',
      content: 'Private mural content', widgets: [{ id: 'secret' }], comments: [{ text: 'Private comment' }], members: [{ email: 'private@example.test' }], url: 'https://private.example/mural'
    }] } }) };
    const client = new MuralWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'mural-token' }) } });
    const result = await client.fetchDelta({ metadata: { fields: { muralWorkspaceId: 'workspace_123' } } }, '2026-07-10T00:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith('https://app.mural.co/api/public/v1/workspaces/workspace_123/murals', expect.objectContaining({
      params: { status: 'active', sortBy: 'lastModified', limit: 100 }, headers: expect.objectContaining({ Authorization: 'Bearer mural-token' }),
      maxContentLength: 2000000, maxBodyLength: 2000000, maxRedirects: 0, proxy: false
    }));
    expect(result.records).toEqual([expect.objectContaining({ id: 'mural:workspace_123.456', sourceType: 'mural', workspaceId: 'workspace_123', name: 'Delivery [redacted email] [redacted url]' })]);
    expect(JSON.stringify(result)).not.toMatch(/Private mural content|Private comment|private@example\.test|private\.example|mural-token/);
    expect(result.metadata.contentPolicy).toContain('no_mural_content_widgets_comments');
  });

  test('fails closed for missing selections, invalid cursors, and incomplete provider pages', async () => {
    const client = new MuralWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'mural-token' }) } });
    await expect(client.fetchDelta({}, null)).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta({ metadata: { fields: { muralWorkspaceId: 'workspace_123' } } }, 'invalid')).rejects.toMatchObject({ statusCode: 400 });
    const capped = new MuralWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { value: [{ id: 'mural-1', title: 'One' }], next: 'next' } }) }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'mural-token' }) } });
    await expect(capped.fetchDelta({ metadata: { fields: { muralWorkspaceId: 'workspace_123' } } })).rejects.toMatchObject({ statusCode: 413 });
  });

  test('selects only a currently authorized workspace and exposes a read-only adapter', async () => {
    const originalEncryptionKey = process.env.CONNECTOR_ENCRYPTION_KEY;
    const originalHttp = accountConnectorService.http;
    process.env.CONNECTOR_ENCRYPTION_KEY = 'connector-encryption-key-for-mural-tests-123456';
    const get = jest.fn().mockResolvedValue({ data: { value: [{ id: 'workspace_123', name: 'Delivery workspace', members: [{ email: 'private@example.test' }] }] } });
    const account = { _id: 'account-mural-1', workspaceId: 'workspace-1', connectorId: 'mural', connectorName: 'Mural', category: 'whiteboard_design', authType: 'oauth2', status: 'failed', credentials: { accessToken: accountConnectorService.encrypt('mural-token-value') }, metadata: { fields: {} }, save: jest.fn().mockResolvedValue(undefined) };
    const accountSpy = jest.spyOn(accountConnectorService, 'getManagedAccount').mockResolvedValue(account);
    accountConnectorService.http = { get };

    try {
      const workspaces = await accountConnectorService.getMuralWorkspaces('account-mural-1', { workspaceId: 'workspace-1' });
      expect(workspaces).toEqual([{ muralWorkspaceId: 'workspace_123', name: 'Delivery workspace' }]);
      expect(get).toHaveBeenCalledWith('https://app.mural.co/api/public/v1/workspaces', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer mural-token-value' }), maxContentLength: 2000000, maxBodyLength: 2000000, maxRedirects: 0, proxy: false }));
      const selected = await accountConnectorService.selectMuralWorkspace('account-mural-1', 'workspace_123', { workspaceId: 'workspace-1' });
      expect(account.metadata.fields).toEqual({ muralWorkspaceId: 'workspace_123' });
      expect(selected.metadata.fields).toEqual({ muralWorkspaceId: 'workspace_123' });
      expect(JSON.stringify(selected)).not.toContain('mural-token-value');
      await expect(accountConnectorService.selectMuralWorkspace('account-mural-1', 'invalid!', { workspaceId: 'workspace-1' })).rejects.toMatchObject({ statusCode: 400 });
    } finally {
      accountSpy.mockRestore();
      accountConnectorService.http = originalHttp;
      if (originalEncryptionKey === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY;
      else process.env.CONNECTOR_ENCRYPTION_KEY = originalEncryptionKey;
    }

    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(workSignalAdapterService.getAdapter('mural').capabilities).toMatchObject({ credentialBackedSync: true, applyAction: false });
    const normalized = workSignalAdapterService.normalize({ connectorId: 'mural' }, { id: 'mural:mural-1', muralId: 'mural-1', workspaceId: 'workspace_123', name: 'Delivery plan', status: 'open', updatedAt: '2026-07-14T12:00:00.000Z', content: 'Private mural content', comments: [{ id: 'secret' }] });
    expect(normalized).toMatchObject({ externalId: 'mural:mural-1', sourceType: 'mural', title: 'Delivery plan', description: '', url: undefined, raw: { muralId: 'mural-1', workspaceId: 'workspace_123', status: 'open' } });
    expect(JSON.stringify(normalized)).not.toMatch(/Private mural content|secret/);
  });
});
