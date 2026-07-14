const accountConnectorService = require('../src/services/accountConnectorService');
const { XeroWorkSignalClient } = require('../src/services/xeroWorkSignalClient');
const { getConnector } = require('../src/services/connectorRegistry');
const { buildConnectorSafetyProfile } = require('../src/services/connectorSafetyProfile');

const TENANT_ID = '65c5b0b1-8a1b-4a5f-8e4d-5b02df18b812';
const INVOICE_ID = 'f8eebca7-3c87-4b2f-b859-2b3244e2806b';

describe('Xero connector', () => {
  test('uses the current granular read-only invoice scope with guarded OAuth consent', () => {
    const connector = getConnector('xero');
    const profile = buildConnectorSafetyProfile(connector);
    expect(connector.auth).toMatchObject({ type: 'oauth2', tokenAuth: 'basic', scopes: ['offline_access', 'accounting.invoices.read'] });
    expect(profile).toMatchObject({ scopeReviewRequired: true, providerScopeReviewRequired: false, scopeRisk: 'guarded' });
  });

  test('reads one selected organisation sales-invoice page without retaining finance or contact fields', async () => {
    const http = { get: jest.fn().mockResolvedValue({
      data: { Invoices: [{
        InvoiceID: INVOICE_ID, Type: 'ACCREC', Status: 'AUTHORISED', Date: '2026-07-10', DueDate: '2026-07-20', UpdatedDateUTC: '2026-07-14T09:00:00.000Z',
        InvoiceNumber: 'INV-2026-99', Total: 9999, AmountDue: 9999, Contact: { Name: 'Private client' }, LineItems: [{ Description: 'Private line' }], Url: 'https://private.example.test'
      }] }
    }) };
    const client = new XeroWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'xero-token' }) } });

    const result = await client.fetchDelta({ metadata: { fields: { xeroTenantId: TENANT_ID } } }, null);

    expect(http.get).toHaveBeenCalledWith('https://api.xero.com/api.xro/2.0/Invoices', expect.objectContaining({
      params: { page: 1, where: 'Type=="ACCREC"', order: 'UpdatedDateUTC DESC' },
      headers: expect.objectContaining({ Authorization: 'Bearer xero-token', 'xero-tenant-id': TENANT_ID }),
      maxRedirects: 0,
      proxy: false
    }));
    expect(result.records).toEqual([expect.objectContaining({ id: `sales_invoice:${INVOICE_ID}`, tenantId: TENANT_ID, status: 'AUTHORISED', dueAt: '2026-07-20T00:00:00.000Z' })]);
    expect(JSON.stringify(result)).not.toMatch(/INV-2026-99|9999|Private client|Private line|private\.example|xero-token/);
    expect(result.metadata.contentPolicy).toContain('no_contacts_invoice_numbers_amounts');
  });

  test('fails closed for an unselected organisation, invalid cursor, or capped provider page', async () => {
    const client = new XeroWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'xero-token' }) } });
    await expect(client.fetchDelta({ metadata: { fields: {} } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta({ metadata: { fields: { xeroTenantId: TENANT_ID } } }, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });

    const originalCap = process.env.SNEUP_XERO_MAX_INVOICES;
    process.env.SNEUP_XERO_MAX_INVOICES = '1';
    const capped = new XeroWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { Invoices: [{ InvoiceID: INVOICE_ID, Type: 'ACCREC', Status: 'AUTHORISED' }] } }) }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'xero-token' }) } });
    try {
      await expect(capped.fetchDelta({ metadata: { fields: { xeroTenantId: TENANT_ID } } })).rejects.toMatchObject({ statusCode: 413 });
    } finally {
      if (originalCap === undefined) delete process.env.SNEUP_XERO_MAX_INVOICES;
      else process.env.SNEUP_XERO_MAX_INVOICES = originalCap;
    }
  });

  test('selects only a currently authorized Xero organisation and persists its opaque ID', async () => {
    const originalEncryptionKey = process.env.CONNECTOR_ENCRYPTION_KEY;
    const originalHttp = accountConnectorService.http;
    process.env.CONNECTOR_ENCRYPTION_KEY = 'connector-encryption-key-for-xero-tests-123456789';
    const get = jest.fn().mockResolvedValue({ data: [{ tenantId: TENANT_ID, tenantName: 'Private delivery organisation', tenantType: 'ORGANISATION' }] });
    const account = {
      _id: 'account-xero-1', workspaceId: 'workspace-1', connectorId: 'xero', connectorName: 'Xero', category: 'time_finance', authType: 'oauth2', status: 'failed',
      credentials: { accessToken: accountConnectorService.encrypt('xero-token-value') }, metadata: { fields: {} }, save: jest.fn().mockResolvedValue(undefined)
    };
    const accountSpy = jest.spyOn(accountConnectorService, 'getManagedAccount').mockResolvedValue(account);
    accountConnectorService.http = { get };

    try {
      const tenants = await accountConnectorService.getXeroTenants('account-xero-1', { workspaceId: 'workspace-1' });
      expect(tenants).toEqual([{ xeroTenantId: TENANT_ID, name: 'Private delivery organisation' }]);
      expect(get).toHaveBeenCalledWith('https://api.xero.com/connections', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer xero-token-value' }), maxRedirects: 0, proxy: false }));
      const selected = await accountConnectorService.selectXeroTenant('account-xero-1', TENANT_ID, { workspaceId: 'workspace-1' });
      expect(account.metadata.fields).toEqual({ xeroTenantId: TENANT_ID });
      expect(selected.metadata.fields).toEqual({ xeroTenantId: TENANT_ID });
      expect(JSON.stringify(selected)).not.toMatch(/Private delivery organisation|xero-token-value/);
      await expect(accountConnectorService.selectXeroTenant('account-xero-1', 'invalid', { workspaceId: 'workspace-1' })).rejects.toMatchObject({ statusCode: 400 });
    } finally {
      accountSpy.mockRestore();
      accountConnectorService.http = originalHttp;
      if (originalEncryptionKey === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY;
      else process.env.CONNECTOR_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  test('exposes a read-only adapter and retains only approved invoice metadata in normalized signals', () => {
    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(workSignalAdapterService.getAdapter('xero').capabilities).toMatchObject({ credentialBackedSync: true, applyAction: false });
    const normalized = workSignalAdapterService.normalize({ connectorId: 'xero' }, {
      id: `sales_invoice:${INVOICE_ID}`, invoiceId: INVOICE_ID, tenantId: TENANT_ID, status: 'AUTHORISED', dueAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-14T09:00:00.000Z',
      InvoiceNumber: 'INV-2026-99', Total: 9999, Contact: { Name: 'Private client' }
    });
    expect(normalized).toMatchObject({ externalId: `sales_invoice:${INVOICE_ID}`, sourceType: 'sales_invoice', title: 'Xero sales invoice', description: '', url: undefined, raw: { invoiceId: INVOICE_ID, tenantId: TENANT_ID, status: 'AUTHORISED' } });
    expect(JSON.stringify(normalized)).not.toMatch(/INV-2026-99|9999|Private client/);
  });
});
