describe('Tableau Cloud work-signal sync', () => {
  const account = {
    connectorId: 'tableau',
    metadata: { fields: { baseUrl: 'https://10ay.online.tableau.com', siteContentUrl: 'marketing-team' } }
  };

  const createHttp = () => ({
    post: jest.fn().mockResolvedValue({ data: { credentials: { token: 'tableau-session-token-1234567890', site: { id: '9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d' } } } }),
    get: jest.fn((url) => {
      if (url.endsWith('/projects')) {
        return Promise.resolve({ data: { pagination: { totalAvailable: '1' }, projects: { project: [{ id: 'project-9', name: 'Executive finance private@example.test', createdAt: '2026-07-10T00:00:00Z', updatedAt: '2026-07-12T00:00:00Z', description: 'Private description', owner: { name: 'Private owner' } }] } } });
      }
      return Promise.resolve({ data: { pagination: { totalAvailable: '1' }, workbooks: { workbook: [{ id: 'workbook-18', name: 'Delivery dashboard https://private.example.test', project: { id: 'project-9', name: 'Executive finance private@example.test' }, createdAt: '2026-07-11T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z', description: 'Private dashboard', owner: { name: 'Private owner' }, tags: { tag: [{ label: 'private' }] }, webpageUrl: 'https://private.example.test' }] } } });
    }),
    delete: jest.fn().mockResolvedValue({ status: 204 })
  });

  afterEach(() => {
    delete process.env.SNEUP_TABLEAU_MAX_PROJECTS;
    delete process.env.SNEUP_TABLEAU_MAX_WORKBOOKS;
    delete process.env.SNEUP_TABLEAU_PAGE_SIZE;
    delete process.env.SNEUP_TABLEAU_API_VERSION;
    jest.resetModules();
  });

  test('reads capped project and workbook metadata, removes private content, and invalidates the session', async () => {
    jest.dontMock('../src/services/tableauWorkSignalClient');
    jest.resetModules();
    const { TableauWorkSignalClient } = require('../src/services/tableauWorkSignalClient');
    const http = createHttp();
    const client = new TableauWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ personalAccessTokenName: 'sneup-readonly', personalAccessTokenSecret: 'tableau-pat-secret' })) } });

    const result = await client.fetchDelta(account, '2026-07-11T00:00:00.000Z');

    expect(http.post).toHaveBeenCalledWith('https://10ay.online.tableau.com/api/3.29/auth/signin', expect.objectContaining({ credentials: expect.objectContaining({ personalAccessTokenName: 'sneup-readonly', personalAccessTokenSecret: 'tableau-pat-secret', site: { contentUrl: 'marketing-team' } }) }), expect.objectContaining({ maxRedirects: 0, proxy: false }));
    expect(http.get).toHaveBeenCalledWith('https://10ay.online.tableau.com/api/3.29/sites/9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d/projects', expect.objectContaining({ params: { pageSize: 100, pageNumber: 1 }, headers: expect.objectContaining({ 'X-Tableau-Auth': 'tableau-session-token-1234567890' }), maxRedirects: 0, proxy: false }));
    expect(http.get).toHaveBeenCalledWith('https://10ay.online.tableau.com/api/3.29/sites/9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d/workbooks', expect.objectContaining({ params: { pageSize: 100, pageNumber: 1 }, headers: expect.objectContaining({ 'X-Tableau-Auth': 'tableau-session-token-1234567890' }), maxRedirects: 0, proxy: false }));
    expect(http.delete).toHaveBeenCalledWith('https://10ay.online.tableau.com/api/3.29/auth/signout', expect.objectContaining({ headers: expect.objectContaining({ 'X-Tableau-Auth': 'tableau-session-token-1234567890' }), maxRedirects: 0, proxy: false }));
    expect(result).toMatchObject({ metadata: { source: 'tableau_cloud_project_workbook_metadata', projects: 1, workbooks: 1 }, nextCursor: '2026-07-13T00:00:00.000Z', hasMore: false });
    expect(result.records).toEqual([expect.objectContaining({ id: 'project:project-9', sourceType: 'project' }), expect.objectContaining({ id: 'workbook:workbook-18', sourceType: 'workbook', projectId: 'project-9' })]);
    expect(JSON.stringify(result.records)).not.toMatch(/private@example\.test|private\.example|Private description|Private dashboard|Private owner|tableau-pat-secret|tableau-session-token/);
  });

  test('fails closed for invalid account targets, invalid cursors, malformed provider metadata, and collection overflow', async () => {
    jest.dontMock('../src/services/tableauWorkSignalClient');
    jest.resetModules();
    const { TableauWorkSignalClient } = require('../src/services/tableauWorkSignalClient');
    const connector = { getAccountCredentials: jest.fn(() => ({ personalAccessTokenName: 'sneup-readonly', personalAccessTokenSecret: 'tableau-pat-secret' })) };
    const invalid = new TableauWorkSignalClient({ http: { post: jest.fn(), get: jest.fn(), delete: jest.fn() }, accountConnectorService: connector });
    await expect(invalid.fetchDelta({ metadata: { fields: { baseUrl: 'https://127.0.0.1', siteContentUrl: 'marketing-team' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(invalid.fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });
    await expect(invalid.fetchDelta({ metadata: { fields: { baseUrl: 'https://10ay.online.tableau.com', siteContentUrl: '../private' } } })).rejects.toMatchObject({ statusCode: 400 });
    const malformed = new TableauWorkSignalClient({ http: { post: jest.fn().mockResolvedValue({ data: { credentials: { token: 'short', site: { id: 'site-1' } } } }), get: jest.fn(), delete: jest.fn() }, accountConnectorService: connector });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
    process.env.SNEUP_TABLEAU_MAX_PROJECTS = '1';
    const capped = new TableauWorkSignalClient({ http: { post: jest.fn().mockResolvedValue({ data: { credentials: { token: 'tableau-session-token-1234567890', site: { id: 'site-1' } } } }), get: jest.fn().mockResolvedValue({ data: { pagination: { totalAvailable: '2' }, projects: { project: [{ id: 'project-1', name: 'One' }] } } }), delete: jest.fn().mockResolvedValue({ status: 204 }) }, accountConnectorService: connector });
    await expect(capped.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 });
  });

  test('exposes Tableau as a read-only credential-backed adapter and normalizes only the allowlisted fields', () => {
    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(workSignalAdapterService.getAdapter('tableau').capabilities.credentialBackedSync).toBe(true);
    const normalized = workSignalAdapterService.normalize({ connectorId: 'tableau' }, {
      id: 'workbook:workbook-18', sourceType: 'workbook', workbookId: 'workbook-18', projectId: 'project-9', projectName: 'Private project', name: 'Ship Tableau connector', status: 'open', createdAt: '2026-07-11T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z', description: 'Private dashboard', owner: { name: 'Private owner' }, webpageUrl: 'https://private.example.test'
    });
    expect(normalized).toMatchObject({ externalId: 'workbook:workbook-18', sourceType: 'workbook', title: 'Ship Tableau connector', description: '', url: undefined, raw: { workbookId: 'workbook-18', projectId: 'project-9', projectName: 'Private project' } });
    expect(JSON.stringify(normalized)).not.toMatch(/Private dashboard|Private owner|private\.example/);
  });
});
