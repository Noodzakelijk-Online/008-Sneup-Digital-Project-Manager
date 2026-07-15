const axios = require('axios');
const accountConnectorService = require('../src/services/accountConnectorService');
const { QuickBooksWorkSignalClient } = require('../src/services/quickBooksWorkSignalClient');
const { getConnector } = require('../src/services/connectorRegistry');
const { buildConnectorSafetyProfile } = require('../src/services/connectorSafetyProfile');

const REALM_ID = '123456789012345';

describe('QuickBooks Online connector', () => {
  test('uses reviewed accounting OAuth and retains only the validated callback company ID', async () => {
    const original = { state: process.env.CONNECTOR_STATE_SECRET, encryption: process.env.CONNECTOR_ENCRYPTION_KEY, clientId: process.env.QUICKBOOKS_CLIENT_ID, clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET };
    process.env.CONNECTOR_STATE_SECRET = 'connector-state-secret-for-quickbooks-tests-123456';
    process.env.CONNECTOR_ENCRYPTION_KEY = 'connector-encryption-key-for-quickbooks-tests-123456';
    process.env.QUICKBOOKS_CLIENT_ID = 'quickbooks-client-id';
    process.env.QUICKBOOKS_CLIENT_SECRET = 'quickbooks-client-secret';
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'quickbooks-access-token' } });

    try {
      const connector = getConnector('quickbooks');
      const profile = buildConnectorSafetyProfile(connector);
      expect(connector.auth).toMatchObject({ type: 'oauth2', tokenAuth: 'basic', scopes: ['com.intuit.quickbooks.accounting'], oauthCallbackMetadata: [{ field: 'quickBooksRealmId', queryKey: 'realmId', validator: 'quickBooksRealmId', required: true }] });
      expect(profile).toMatchObject({ scopeReviewRequired: true, providerScopeReviewRequired: true, scopeRisk: 'review' });
      expect(accountConnectorService.extractOAuthCallbackMetadata(connector, { realmId: REALM_ID, customer: 'private customer' })).toEqual({ quickBooksRealmId: REALM_ID });
      expect(() => accountConnectorService.extractOAuthCallbackMetadata(connector, { realmId: 'https://private.example' })).toThrow(/valid company realm ID/i);
      expect(() => accountConnectorService.extractOAuthCallbackMetadata(connector, {})).toThrow(/valid company realm ID/i);

      const connection = accountConnectorService.beginConnection('quickbooks', { baseUrl: 'https://sneup.example', scopeAcknowledged: true, actorId: 'operator-1' });
      expect(new URL(connection.authUrl)).toMatchObject({ hostname: 'appcenter.intuit.com', pathname: '/connect/oauth2' });
      await accountConnectorService.exchangeCodeForToken(connector, 'authorization-code', 'https://sneup.example');
      expect(post).toHaveBeenCalledWith('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', expect.stringContaining('grant_type=authorization_code'), expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Basic ${Buffer.from('quickbooks-client-id:quickbooks-client-secret').toString('base64')}` }) }));

      const state = accountConnectorService.createState({ connectorId: 'quickbooks', workspaceId: '507f1f77bcf86cd799439011', returnTo: '/', consent: { acknowledgedBy: 'operator-1' } });
      const databaseReady = jest.spyOn(accountConnectorService, 'isDatabaseReady').mockReturnValue(true);
      const exchange = jest.spyOn(accountConnectorService, 'exchangeCodeForToken').mockResolvedValue({ access_token: 'quickbooks-access-token' });
      const save = jest.spyOn(accountConnectorService, 'saveOAuthAccount').mockResolvedValue({ _id: 'account-1', connectorId: 'quickbooks', connectorName: 'QuickBooks Online', category: 'time_finance', authType: 'oauth2', status: 'connected', metadata: {} });
      try {
        await accountConnectorService.completeOAuth('quickbooks', { state, code: 'provider-code', realmId: REALM_ID, customer: 'private customer' }, { baseUrl: 'https://sneup.example' });
        expect(save).toHaveBeenCalledWith(connector, { access_token: 'quickbooks-access-token' }, expect.objectContaining({ callbackMetadata: { quickBooksRealmId: REALM_ID } }));
      } finally {
        save.mockRestore();
        exchange.mockRestore();
        databaseReady.mockRestore();
      }
    } finally {
      post.mockRestore();
      if (original.state === undefined) delete process.env.CONNECTOR_STATE_SECRET; else process.env.CONNECTOR_STATE_SECRET = original.state;
      if (original.encryption === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY; else process.env.CONNECTOR_ENCRYPTION_KEY = original.encryption;
      if (original.clientId === undefined) delete process.env.QUICKBOOKS_CLIENT_ID; else process.env.QUICKBOOKS_CLIENT_ID = original.clientId;
      if (original.clientSecret === undefined) delete process.env.QUICKBOOKS_CLIENT_SECRET; else process.env.QUICKBOOKS_CLIENT_SECRET = original.clientSecret;
    }
  });

  test('reads one bounded selected-company invoice page without retaining financial or customer details', async () => {
    const http = { get: jest.fn().mockResolvedValue({ data: { QueryResponse: { Invoice: [{
      Id: '42', TxnStatus: 'OPEN', TxnDate: '2026-07-10', DueDate: '2026-07-20', MetaData: { LastUpdatedTime: '2026-07-14T09:00:00.000Z' }, DocNumber: 'INV-2026-99', TotalAmt: 9999, Balance: 9999, CustomerRef: { name: 'Private client' }, Line: [{ Description: 'Private line' }], BillEmail: { Address: 'private@example.test' }, TxnSource: 'https://private.example/test'
    }] } } }) };
    const client = new QuickBooksWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'quickbooks-token' }) } });

    const result = await client.fetchDelta({ metadata: { fields: { quickBooksRealmId: REALM_ID } } }, null);

    expect(http.get).toHaveBeenCalledWith(`https://quickbooks.api.intuit.com/v3/company/${REALM_ID}/query`, expect.objectContaining({
      params: { query: 'SELECT * FROM Invoice ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 101' }, headers: expect.objectContaining({ Authorization: 'Bearer quickbooks-token' }), maxRedirects: 0, proxy: false
    }));
    expect(result.records).toEqual([expect.objectContaining({ id: 'sales_invoice:42', invoiceId: '42', realmId: REALM_ID, status: 'OPEN', dueAt: '2026-07-20T00:00:00.000Z' })]);
    expect(JSON.stringify(result)).not.toMatch(/INV-2026-99|9999|Private client|Private line|private@example\.test|private\.example|quickbooks-token/);
    expect(result.metadata.contentPolicy).toContain('no_customers_invoice_numbers_amounts');
  });

  test('fails closed for a missing company, invalid cursor, or capped provider page', async () => {
    const client = new QuickBooksWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'quickbooks-token' }) } });
    await expect(client.fetchDelta({ metadata: { fields: {} } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta({ metadata: { fields: { quickBooksRealmId: REALM_ID } } }, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });

    const originalCap = process.env.SNEUP_QUICKBOOKS_MAX_INVOICES;
    process.env.SNEUP_QUICKBOOKS_MAX_INVOICES = '1';
    const capped = new QuickBooksWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { QueryResponse: { Invoice: [{ Id: '1' }, { Id: '2' }] } } }) }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'quickbooks-token' }) } });
    try {
      await expect(capped.fetchDelta({ metadata: { fields: { quickBooksRealmId: REALM_ID } } })).rejects.toMatchObject({ statusCode: 413 });
    } finally {
      if (originalCap === undefined) delete process.env.SNEUP_QUICKBOOKS_MAX_INVOICES;
      else process.env.SNEUP_QUICKBOOKS_MAX_INVOICES = originalCap;
    }
  });

  test('exposes a read-only adapter and normalizes only approved invoice metadata', () => {
    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(workSignalAdapterService.getAdapter('quickbooks').capabilities).toMatchObject({ credentialBackedSync: true, applyAction: false });
    const normalized = workSignalAdapterService.normalize({ connectorId: 'quickbooks' }, { id: 'sales_invoice:42', invoiceId: '42', realmId: REALM_ID, status: 'OPEN', dueAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-14T09:00:00.000Z', TotalAmt: 9999, CustomerRef: { name: 'Private client' }, Line: [{ Description: 'Private line' }] });
    expect(normalized).toMatchObject({ externalId: 'sales_invoice:42', sourceType: 'sales_invoice', title: 'QuickBooks sales invoice', description: '', url: undefined, raw: { invoiceId: '42', realmId: REALM_ID, status: 'OPEN' } });
    expect(JSON.stringify(normalized)).not.toMatch(/9999|Private client|Private line/);
  });
});
