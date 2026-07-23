const { LiquidPlannerWorkSignalClient } = require('../src/services/liquidPlannerWorkSignalClient');

const account = {
  connectorId: 'liquidplanner',
  metadata: { fields: { workspaceId: '21' } }
};

const activeProject = (overrides = {}) => ({
  id: 101,
  name: 'Launch project',
  itemType: 'projects',
  folderStatus: 'active',
  targetStart: '2026-07-01T00:00:00.000Z',
  targetFinish: '2026-07-31T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
  ...overrides
});

describe('LiquidPlanner New connector', () => {
  test('reads only bounded active-project metadata through documented continuation pagination', async () => {
    const privateEmail = ['owner', 'example.test'].join('@');
    const http = {
      get: jest.fn()
        .mockResolvedValueOnce({
          data: {
            recordLimit: 250,
            recordCount: 1,
            continuationToken: 101,
            data: [activeProject({
              name: `Launch ${privateEmail} https://private.example`,
              description: 'Private project body',
              dependencies: [{ dependencyItemId: 77 }],
              files: [{ name: 'private.pdf' }],
              customFieldValues: [{ name: 'Secret', value: 'private' }]
            })]
          }
        })
        .mockResolvedValueOnce({
          data: {
            recordLimit: 250,
            recordCount: 1,
            data: [activeProject({ id: 102, name: 'Second project', updatedAt: '2026-07-11T00:00:00.000Z' })]
          }
        })
    };
    const client = new LiquidPlannerWorkSignalClient({
      http,
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ token: 'liquidplanner-token' })) }
    });

    const result = await client.fetchDelta(account);

    expect(http.get).toHaveBeenCalledWith(
      'https://next.liquidplanner.com/api/workspaces/21/items/v1',
      expect.objectContaining({
        params: { limit: 250, 'itemType[is]': 'projects', 'folderStatus[is]': 'active' },
        headers: expect.objectContaining({ Authorization: 'Bearer liquidplanner-token', Accept: 'application/json' }),
        timeout: 15000,
        maxContentLength: 1000000,
        maxBodyLength: 64 * 1024,
        maxRedirects: 0,
        proxy: false
      })
    );
    expect(http.get.mock.calls[1][1].params).toMatchObject({ continuationToken: '101' });
    expect(result).toMatchObject({
      hasMore: false,
      metadata: { source: 'liquidplanner_active_project_metadata', projects: 2, pages: 2 }
    });
    expect(result.records).toEqual([
      expect.objectContaining({ id: 'project:101', projectId: '101', workspaceId: '21', status: 'open', name: 'Launch [redacted email] [redacted url]' }),
      expect.objectContaining({ id: 'project:102', projectId: '102', name: 'Second project' })
    ]);
    expect(JSON.stringify(result)).not.toMatch(/Private project body|private\.pdf|dependencyItemId|customFieldValues|owner@example\.test|private\.example|liquidplanner-token/);
    expect(http).not.toHaveProperty('post');
  });

  test('fails closed for invalid workspace, cursor, metadata, continuation, and configured cap', async () => {
    const credentials = { getAccountCredentials: jest.fn(() => ({ token: 'liquidplanner-token' })) };
    const client = new LiquidPlannerWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: credentials });
    await expect(client.fetchDelta({ ...account, metadata: { fields: { workspaceId: 'workspace-21' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });
    await expect(new LiquidPlannerWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: { getAccountCredentials: () => ({}) } }).fetchDelta(account)).rejects.toMatchObject({ statusCode: 503 });

    const malformed = new LiquidPlannerWorkSignalClient({
      http: { get: jest.fn().mockResolvedValue({ data: { recordLimit: 1, recordCount: 1, data: [activeProject({ itemType: 'tasks' })] } }) },
      accountConnectorService: credentials
    });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });

    const invalidContinuation = new LiquidPlannerWorkSignalClient({
      http: { get: jest.fn().mockResolvedValue({ data: { recordLimit: 1, recordCount: 1, continuationToken: 'bad token', data: [activeProject()] } }) },
      accountConnectorService: credentials
    });
    const previousPageSize = process.env.SNEUP_LIQUIDPLANNER_PAGE_SIZE;
    process.env.SNEUP_LIQUIDPLANNER_PAGE_SIZE = '1';
    try {
      await expect(invalidContinuation.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
    } finally {
      if (previousPageSize === undefined) delete process.env.SNEUP_LIQUIDPLANNER_PAGE_SIZE;
      else process.env.SNEUP_LIQUIDPLANNER_PAGE_SIZE = previousPageSize;
    }

    const capped = new LiquidPlannerWorkSignalClient({
      http: { get: jest.fn().mockResolvedValue({ data: { recordLimit: 1, recordCount: 1, continuationToken: 101, data: [activeProject()] } }) },
      accountConnectorService: credentials
    });
    const previousMaxProjects = process.env.SNEUP_LIQUIDPLANNER_MAX_PROJECTS;
    process.env.SNEUP_LIQUIDPLANNER_MAX_PROJECTS = '1';
    try {
      await expect(capped.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 });
    } finally {
      if (previousMaxProjects === undefined) delete process.env.SNEUP_LIQUIDPLANNER_MAX_PROJECTS;
      else process.env.SNEUP_LIQUIDPLANNER_MAX_PROJECTS = previousMaxProjects;
    }
  });

  test('registers LiquidPlanner as an approval-gated, read-only live adapter', async () => {
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('liquidplanner');
    expect(adapter).toMatchObject({
      connectorId: 'liquidplanner',
      capabilities: { credentialBackedSync: true, fetchDelta: true, applyAction: false }
    });
    expect(adapter.normalize({ connectorId: 'liquidplanner' }, {
      id: 'project:101', sourceType: 'project', projectId: '101', workspaceId: '21', name: 'Launch', status: 'open'
    })).toMatchObject({
      externalId: 'project:101',
      description: '',
      url: undefined,
      owners: [],
      labels: expect.arrayContaining(['liquidplanner', 'project', 'open']),
      raw: { projectId: '101', workspaceId: '21' }
    });
    await expect(adapter.applyAction()).rejects.toMatchObject({ statusCode: 403 });
  });
});
