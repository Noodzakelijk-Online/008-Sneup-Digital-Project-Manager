const { LucidWorkSignalClient } = require('../src/services/lucidWorkSignalClient');

describe('Lucid connector', () => {
  test('searches bounded document metadata only with the DocumentReadonly API-key path', async () => {
    const privateEmail = ['owner', 'example.test'].join('@');
    const http = { post: jest.fn().mockResolvedValue({ data: { documents: [{ id: '11111111-1111-4111-8111-111111111111', title: `Launch ${privateEmail} https://private.example`, product: 'lucidchart', createdAt: '2026-07-01T00:00:00.000Z', lastModified: '2026-07-11T00:00:00.000Z', pages: [{ title: 'Private page' }], owner: { email: privateEmail }, sharing: { url: 'https://private.example' } }] }, headers: {} }) };
    const client = new LucidWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ apiKey: 'lucid-key' })) } });
    const result = await client.fetchDelta({ connectorId: 'lucid' }, '2026-07-01T00:00:00.000Z');

    expect(http.post).toHaveBeenCalledWith('https://api.lucid.co/v1/documents/search', expect.objectContaining({ excludeTrashed: true, lastModifiedAfter: '2026-06-30T23:59:00.000Z' }), expect.objectContaining({ params: { pageSize: 100 }, headers: expect.objectContaining({ Authorization: 'Bearer lucid-key', 'Lucid-Api-Version': '1' }), timeout: 15000, maxContentLength: 1000000, maxRedirects: 0, proxy: false }));
    expect(result).toMatchObject({ metadata: { source: 'lucid_document_metadata', documents: 1, pages: 1 }, hasMore: false });
    expect(result.records).toEqual([expect.objectContaining({ id: 'document:11111111-1111-4111-8111-111111111111', product: 'lucidchart', name: 'Launch [redacted email] [redacted url]' })]);
    expect(JSON.stringify(result.records)).not.toMatch(/Private page|owner@example\.test|private\.example/);
    expect(http).not.toHaveProperty('get');
  });

  test('follows allowlisted next links and fails closed for malformed metadata, links, and caps', async () => {
    const first = { data: { documents: [{ id: '11111111-1111-4111-8111-111111111111', title: 'First', product: 'lucidchart' }] }, headers: { link: '<https://api.lucid.co/v1/documents/search?pageSize=100&pageToken=next-page>; rel="next"' } };
    const second = { data: { documents: [{ id: '22222222-2222-4222-8222-222222222222', title: 'Second', product: 'lucidspark' }] }, headers: {} };
    const accountConnectorService = { getAccountCredentials: jest.fn(() => ({ apiKey: 'lucid-key' })) };
    const http = { post: jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) };
    const client = new LucidWorkSignalClient({ http, accountConnectorService });
    const result = await client.fetchDelta({ connectorId: 'lucid' });
    expect(http.post.mock.calls[1][2].params).toEqual({ pageSize: 100, pageToken: 'next-page' });
    expect(result.records).toHaveLength(2);
    await expect(client.fetchDelta({ connectorId: 'lucid' }, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });
    const malformed = new LucidWorkSignalClient({ http: { post: jest.fn().mockResolvedValue({ data: { documents: [{ id: 'bad-id', title: 'Broken', product: 'lucidchart' }] }, headers: {} }) }, accountConnectorService });
    await expect(malformed.fetchDelta({ connectorId: 'lucid' })).rejects.toMatchObject({ statusCode: 502 });
    const unsafeLink = new LucidWorkSignalClient({ http: { post: jest.fn().mockResolvedValue({ data: { documents: [{ id: '11111111-1111-4111-8111-111111111111', title: 'One', product: 'lucidchart' }] }, headers: { link: '<https://private.example/pageToken=secret>; rel="next"' } }) }, accountConnectorService });
    await expect(unsafeLink.fetchDelta({ connectorId: 'lucid' })).rejects.toMatchObject({ statusCode: 502 });
    const capped = new LucidWorkSignalClient({ http: { post: jest.fn().mockResolvedValue({ data: { documents: [{ id: '11111111-1111-4111-8111-111111111111', title: 'One', product: 'lucidchart' }] }, headers: { link: '<https://api.lucid.co/v1/documents/search?pageSize=1&pageToken=next-page>; rel="next"' } }) }, accountConnectorService });
    const previous = process.env.SNEUP_LUCID_MAX_DOCUMENTS; process.env.SNEUP_LUCID_MAX_DOCUMENTS = '1';
    try { await expect(capped.fetchDelta({ connectorId: 'lucid' })).rejects.toMatchObject({ statusCode: 413 }); } finally { if (previous === undefined) delete process.env.SNEUP_LUCID_MAX_DOCUMENTS; else process.env.SNEUP_LUCID_MAX_DOCUMENTS = previous; }
  });

  test('registers Lucid as an approval-gated, read-only live adapter', () => {
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('lucid');
    expect(adapter).toMatchObject({ connectorId: 'lucid', capabilities: { credentialBackedSync: true, fetchDelta: true, applyAction: false } });
    expect(adapter.normalize({ connectorId: 'lucid' }, { id: 'document:11111111-1111-4111-8111-111111111111', sourceType: 'document', documentId: '11111111-1111-4111-8111-111111111111', product: 'lucidchart', name: 'Launch', status: 'open' })).toMatchObject({ externalId: 'document:11111111-1111-4111-8111-111111111111', description: '', url: undefined, owners: [], labels: expect.arrayContaining(['lucid', 'document', 'lucidchart']) });
  });
});
