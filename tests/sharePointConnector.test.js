const accountConnectorService = require('../src/services/accountConnectorService');
const { SharePointWorkSignalClient } = require('../src/services/sharePointWorkSignalClient');
const { getConnector } = require('../src/services/connectorRegistry');
const { buildConnectorSafetyProfile } = require('../src/services/connectorSafetyProfile');

describe('SharePoint connector', () => {
  test('requires explicit scope review for the delegated selected-site discovery grant', () => {
    const profile = buildConnectorSafetyProfile(getConnector('sharepoint'));
    expect(profile).toMatchObject({
      scopeReviewRequired: true,
      providerScopeReviewRequired: true,
      scopeRisk: 'review'
    });
    expect(profile.requestedScopes).toEqual(expect.arrayContaining(['Files.Read', 'Sites.Read.All']));
  });

  test('reads only one selected followed-site root metadata page', async () => {
    const http = {
      get: jest.fn().mockResolvedValue({
        data: {
          value: [
            {
              id: 'folder-1',
              name: 'Delivery plans',
              folder: {},
              createdDateTime: '2026-07-10T08:00:00.000Z',
              lastModifiedDateTime: '2026-07-14T09:00:00.000Z',
              webUrl: 'https://contoso.sharepoint.com/sites/delivery/Shared%20Documents'
            }
          ]
        }
      })
    };
    const client = new SharePointWorkSignalClient({
      http,
      accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'sharepoint-token' }) }
    });

    const result = await client.fetchDelta({
      metadata: { fields: { sharePointSiteId: 'contoso.sharepoint.com,site-1,web-1' } }
    }, null);

    expect(http.get).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com%2Csite-1%2Cweb-1/drive/root/children',
      expect.objectContaining({
        params: expect.objectContaining({ '$select': 'id,name,folder,package,createdDateTime,lastModifiedDateTime,deleted' }),
        headers: expect.objectContaining({ Authorization: 'Bearer sharepoint-token' }),
        maxRedirects: 0,
        proxy: false
      })
    );
    expect(result.records).toEqual([expect.objectContaining({
      sourceType: 'folder', itemId: 'folder-1', siteId: 'contoso.sharepoint.com,site-1,web-1', name: 'Delivery plans'
    })]);
    expect(JSON.stringify(result)).not.toContain('webUrl');
    expect(result.metadata.contentPolicy).toContain('no_file_contents');
  });

  test('fails closed when the selected-site page would exceed its cap', async () => {
    const http = {
      get: jest.fn().mockResolvedValue({
        data: { value: [{ id: 'file-1', name: 'Plan', createdDateTime: '2026-07-10T08:00:00.000Z' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next' }
      })
    };
    const client = new SharePointWorkSignalClient({
      http,
      accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'sharepoint-token' }) }
    });
    const originalCap = process.env.SNEUP_SHAREPOINT_MAX_ITEMS;
    process.env.SNEUP_SHAREPOINT_MAX_ITEMS = '1';

    try {
      await expect(client.fetchDelta({ metadata: { fields: { sharePointSiteId: 'contoso.sharepoint.com,site-1,web-1' } } }, null))
        .rejects.toMatchObject({ statusCode: 413 });
    } finally {
      if (originalCap === undefined) delete process.env.SNEUP_SHAREPOINT_MAX_ITEMS;
      else process.env.SNEUP_SHAREPOINT_MAX_ITEMS = originalCap;
    }
  });

  test('selects only a currently followed site and persists its opaque ID', async () => {
    const originalEncryptionKey = process.env.CONNECTOR_ENCRYPTION_KEY;
    const originalHttp = accountConnectorService.http;
    process.env.CONNECTOR_ENCRYPTION_KEY = 'connector-encryption-key-for-sharepoint-tests-123456';
    const get = jest.fn().mockResolvedValue({
      data: {
        value: [
          { id: 'contoso.sharepoint.com,site-1,web-1', displayName: 'Delivery workspace', webUrl: 'https://contoso.sharepoint.com/sites/delivery' }
        ]
      }
    });
    const account = {
      _id: 'account-sharepoint-1', workspaceId: 'workspace-1', connectorId: 'sharepoint', connectorName: 'SharePoint', category: 'files_assets', authType: 'oauth2', status: 'failed',
      credentials: { accessToken: accountConnectorService.encrypt('sharepoint-token-value') }, metadata: { fields: {} }, save: jest.fn().mockResolvedValue(undefined)
    };
    const accountSpy = jest.spyOn(accountConnectorService, 'getManagedAccount').mockResolvedValue(account);
    accountConnectorService.http = { get };

    try {
      const sites = await accountConnectorService.getSharePointSites('account-sharepoint-1', { workspaceId: 'workspace-1' });
      expect(sites).toEqual([{ sharePointSiteId: 'contoso.sharepoint.com,site-1,web-1', name: 'Delivery workspace' }]);
      expect(get).toHaveBeenCalledWith(
        'https://graph.microsoft.com/v1.0/me/followedSites',
        expect.objectContaining({
          params: { '$select': 'id,displayName' },
          headers: expect.objectContaining({ Authorization: 'Bearer sharepoint-token-value' }),
          maxRedirects: 0,
          proxy: false
        })
      );

      const selected = await accountConnectorService.selectSharePointSite(
        'account-sharepoint-1',
        'contoso.sharepoint.com,site-1,web-1',
        { workspaceId: 'workspace-1' }
      );
      expect(account.metadata.fields).toEqual({ sharePointSiteId: 'contoso.sharepoint.com,site-1,web-1' });
      expect(selected.metadata.fields).toEqual({ sharePointSiteId: 'contoso.sharepoint.com,site-1,web-1' });
      expect(JSON.stringify(selected)).not.toContain('sharepoint-token-value');
      await expect(accountConnectorService.selectSharePointSite('account-sharepoint-1', 'invalid!', { workspaceId: 'workspace-1' }))
        .rejects.toMatchObject({ statusCode: 400 });
    } finally {
      accountSpy.mockRestore();
      accountConnectorService.http = originalHttp;
      if (originalEncryptionKey === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY;
      else process.env.CONNECTOR_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });
});
