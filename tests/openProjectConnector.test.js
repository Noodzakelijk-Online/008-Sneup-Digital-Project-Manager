const { OpenProjectWorkSignalClient } = require('../src/services/openProjectWorkSignalClient');

const account = { connectorId: 'openproject', metadata: { fields: { baseUrl: 'https://projects.example.test' } } };
const publicResolver = () => Promise.resolve(['8.8.8.8']);
const emptyResolver = () => Promise.resolve([]);

describe('OpenProject connector', () => {
  test('reads bounded project and work-package metadata through the documented v3 collection endpoints', async () => {
    const privateEmail = ['owner', 'example.test'].join('@');
    const http = { get: jest.fn()
      .mockResolvedValueOnce({ data: { total: 1, count: 1, _embedded: { elements: [{ id: 7, name: `Delivery ${privateEmail} https://private.example`, identifier: 'delivery', active: true, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-10T10:00:00.000Z', description: { raw: 'Private project body' } }] } } })
      .mockResolvedValueOnce({ data: { total: 1, count: 1, _embedded: { elements: [{ id: 19, subject: 'Prepare handoff', percentageDone: 50, startDate: '2026-07-10', dueDate: '2026-07-20', createdAt: '2026-07-02T00:00:00.000Z', updatedAt: '2026-07-11T10:00:00.000Z', _links: { project: { href: '/api/v3/projects/7' }, status: { title: 'In progress' }, priority: { title: 'High' } }, description: { raw: 'Private work package body' }, attachments: [{ fileName: 'secret.pdf' }] }] } } }) };
    const client = new OpenProjectWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ apiKey: 'openproject-token' })) }, resolve4: publicResolver, resolve6: emptyResolver });
    const result = await client.fetchDelta(account, '2026-07-01T00:00:00.000Z');

    expect(http.get).toHaveBeenNthCalledWith(1, 'https://projects.example.test/api/v3/projects', expect.objectContaining({
      params: { offset: 1, pageSize: 100, select: 'total,count,elements/id,elements/name,elements/identifier,elements/active,elements/createdAt,elements/updatedAt' },
      headers: { Accept: 'application/hal+json', Authorization: 'Bearer openproject-token' }, timeout: 15000, maxContentLength: 1000000, maxRedirects: 0, proxy: false, httpsAgent: expect.anything()
    }));
    expect(http.get).toHaveBeenNthCalledWith(2, 'https://projects.example.test/api/v3/work_packages', expect.objectContaining({
      params: expect.objectContaining({ offset: 1, pageSize: 100, filters: '[]', select: expect.stringContaining('elements/subject') }), headers: { Accept: 'application/hal+json', Authorization: 'Bearer openproject-token' }, maxRedirects: 0, proxy: false
    }));
    expect(http).not.toHaveProperty('post');
    const requested = http.get.mock.calls.map(call => `${call[0]} ${JSON.stringify(call[1].params)}`).join(' ');
    expect(requested).not.toMatch(/description|comments|attachments|people|custom_fields/i);
    expect(result).toMatchObject({ metadata: { source: 'openproject_project_work_package_metadata', projects: 1, workPackages: 1, pages: 2 }, hasMore: false, nextCursor: '2026-07-11T10:00:00.000Z' });
    expect(result.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'project:7', name: 'Delivery [redacted email] [redacted url]', identifier: 'delivery' }),
      expect.objectContaining({ id: 'work_package:19', projectId: '7', status: 'in_progress', priority: 'High', percentageDone: 50, dueAt: '2026-07-20T00:00:00.000Z' })
    ]));
    expect(JSON.stringify(result.records)).not.toMatch(/Private project|Private work package|owner@example\.test|private\.example|secret\.pdf/);
  });

  test('fails closed for untrusted instances, invalid pages, and configured collection caps', async () => {
    const accountConnectorService = { getAccountCredentials: jest.fn(() => ({ apiKey: 'openproject-token' })) };
    const untrustedHttp = { get: jest.fn() };
    const untrustedClient = new OpenProjectWorkSignalClient({ http: untrustedHttp, accountConnectorService, resolve4: publicResolver, resolve6: emptyResolver });
    await expect(untrustedClient.fetchDelta({ metadata: { fields: { baseUrl: 'https://127.0.0.1' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(untrustedClient.fetchDelta({ ...account, metadata: { fields: { baseUrl: 'https://projects.example.test/path' } } })).rejects.toMatchObject({ statusCode: 400 });
    expect(untrustedHttp.get).not.toHaveBeenCalled();

    const malformedClient = new OpenProjectWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { total: 1, count: 1, _embedded: { elements: [] } } }) }, accountConnectorService, resolve4: publicResolver, resolve6: emptyResolver });
    await expect(malformedClient.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });

    const previousLimit = process.env.SNEUP_OPENPROJECT_MAX_WORK_PACKAGES;
    process.env.SNEUP_OPENPROJECT_MAX_WORK_PACKAGES = '1';
    const cappedHttp = { get: jest.fn()
      .mockResolvedValueOnce({ data: { total: 0, count: 0, _embedded: { elements: [] } } })
      .mockResolvedValueOnce({ data: { total: 2, count: 1, _embedded: { elements: [{ id: 19, subject: 'One', percentageDone: 0 }] } } }) };
    const cappedClient = new OpenProjectWorkSignalClient({ http: cappedHttp, accountConnectorService, resolve4: publicResolver, resolve6: emptyResolver });
    try {
      await expect(cappedClient.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 });
      expect(cappedHttp.get).toHaveBeenCalledTimes(2);
    } finally {
      if (previousLimit === undefined) delete process.env.SNEUP_OPENPROJECT_MAX_WORK_PACKAGES;
      else process.env.SNEUP_OPENPROJECT_MAX_WORK_PACKAGES = previousLimit;
    }
  });

  test('registers OpenProject as an approval-gated, read-only live adapter', () => {
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('openproject');
    expect(adapter).toMatchObject({ connectorId: 'openproject', capabilities: { credentialBackedSync: true, fetchDelta: true, applyAction: false } });
    expect(adapter.normalize({ connectorId: 'openproject' }, { id: 'work_package:19', sourceType: 'work_package', workPackageId: '19', projectId: '7', name: 'Prepare handoff', status: 'open', priority: 'High', description: 'Private detail' })).toMatchObject({ externalId: 'work_package:19', description: '', url: undefined, owners: [], labels: expect.arrayContaining(['openproject', 'work_package', 'project:7']) });
  });
});
