describe('Procore work-signal sync', () => {
  const account = {
    connectorId: 'procore',
    metadata: { fields: { procoreCompanyId: '8821' } }
  };

  afterEach(() => {
    delete process.env.SNEUP_PROCORE_MAX_PROJECTS;
    jest.resetModules();
  });

  test('reads capped active-project metadata and removes private provider fields', async () => {
    jest.dontMock('../src/services/procoreWorkSignalClient');
    jest.resetModules();
    const { ProcoreWorkSignalClient } = require('../src/services/procoreWorkSignalClient');
    const http = {
      get: jest.fn().mockResolvedValue({
        data: [{
          id: 17,
          name: 'River build private@example.test',
          active: true,
          actual_start_date: '2026-07-01',
          projected_finish_date: '2026-08-15',
          created_at: '2026-06-20T10:00:00Z',
          updated_at: '2026-07-23T10:00:00Z',
          description: 'Private construction detail',
          estimated_budget: 500000,
          address: 'Private job address',
          owner: { name: 'Private project owner' },
          rfi_count: 8
        }]
      })
    };
    const client = new ProcoreWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ accessToken: 'procore-access-token' })) } });

    const result = await client.fetchDelta(account, '2026-07-20T00:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith('https://api.procore.com/rest/v1.1/projects', expect.objectContaining({
      params: { company_id: '8821', page: 1, per_page: 200 },
      headers: expect.objectContaining({ Authorization: 'Bearer procore-access-token', 'Procore-Company-Id': '8821' }),
      maxRedirects: 0,
      proxy: false
    }));
    expect(result).toMatchObject({ metadata: { source: 'procore_active_project_metadata', companySelected: true, activeProjects: 1 }, nextCursor: '2026-07-23T10:00:00.000Z', hasMore: false });
    expect(result.records).toEqual([expect.objectContaining({ id: 'project:17', sourceType: 'project', companyId: '8821', name: 'River build [redacted email]', dueAt: '2026-08-15T00:00:00.000Z' })]);
    expect(JSON.stringify(result.records)).not.toMatch(/private@example\.test|Private construction detail|500000|Private job address|Private project owner|rfi_count|procore-access-token/);
  });

  test('fails closed for invalid company scope, cursors, provider records, and collection caps', async () => {
    jest.dontMock('../src/services/procoreWorkSignalClient');
    jest.resetModules();
    const { ProcoreWorkSignalClient } = require('../src/services/procoreWorkSignalClient');
    const connector = { getAccountCredentials: jest.fn(() => ({ accessToken: 'procore-access-token' })) };
    const invalid = new ProcoreWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: connector });
    await expect(invalid.fetchDelta({ metadata: { fields: { procoreCompanyId: 'not-a-company' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(invalid.fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });
    const malformed = new ProcoreWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: [{ id: 17, name: '' }] }) }, accountConnectorService: connector });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
    process.env.SNEUP_PROCORE_MAX_PROJECTS = '1';
    const capped = new ProcoreWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: [{ id: 17, name: 'One' }] }) }, accountConnectorService: connector });
    await expect(capped.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 });
  });

  test('validates the selected company with a read-only request before saving the connector scope', async () => {
    jest.dontMock('../src/services/accountConnectorService');
    jest.resetModules();
    const { AccountConnectorService } = require('../src/services/accountConnectorService');
    const http = { get: jest.fn().mockResolvedValue({ data: [] }) };
    const service = new AccountConnectorService({ http });
    const managedAccount = {
      connectorId: 'procore',
      connectorName: 'Procore',
      metadata: { fields: {} },
      save: jest.fn().mockResolvedValue()
    };
    service.getManagedAccount = jest.fn().mockResolvedValue(managedAccount);
    service.getAccountCredentials = jest.fn(() => ({ accessToken: 'procore-access-token' }));
    service.sanitizeAccount = jest.fn(account => account);

    const selected = await service.selectProcoreCompany('account-1', '8821');

    expect(http.get).toHaveBeenCalledWith('https://api.procore.com/rest/v1.1/projects', expect.objectContaining({
      params: { company_id: '8821', page: 1, per_page: 1 },
      headers: expect.objectContaining({ Authorization: 'Bearer procore-access-token', 'Procore-Company-Id': '8821' }),
      maxRedirects: 0,
      proxy: false
    }));
    expect(managedAccount.metadata.fields).toEqual({ procoreCompanyId: '8821' });
    expect(managedAccount.accountName).toBe('Procore - Company 8821');
    expect(managedAccount.externalAccountId).toBe('8821');
    expect(managedAccount.save).toHaveBeenCalledTimes(1);
    expect(selected).toBe(managedAccount);
    await expect(service.selectProcoreCompany('account-1', '../8821')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('exposes Procore as a read-only credential-backed adapter and normalizes only allowlisted fields', () => {
    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(workSignalAdapterService.getAdapter('procore').capabilities).toMatchObject({ credentialBackedSync: true, applyAction: false });
    const normalized = workSignalAdapterService.normalize({ connectorId: 'procore' }, {
      id: 'project:17', sourceType: 'project', projectId: '17', companyId: '8821', name: 'River build', status: 'open', dueAt: '2026-08-15T00:00:00.000Z', createdAt: '2026-06-20T10:00:00.000Z', updatedAt: '2026-07-23T10:00:00.000Z', description: 'Private detail', estimated_budget: 500000, address: 'Private address'
    });
    expect(normalized).toMatchObject({ externalId: 'project:17', sourceType: 'project', title: 'River build', description: '', url: undefined, raw: { projectId: '17', companyId: '8821', status: 'open' } });
    expect(JSON.stringify(normalized)).not.toMatch(/Private detail|500000|Private address/);
  });
});
