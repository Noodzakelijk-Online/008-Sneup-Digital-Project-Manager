const { QuipWorkSignalClient } = require('../src/services/quipWorkSignalClient');

const threadId = 'AVN9AAeqq5w';
const account = { connectorId: 'quip' };
const usec = date => String(new Date(date).getTime() * 1000);

describe('Quip connector', () => {
  test('reads bounded current-user thread index metadata without requesting content or provider writes', async () => {
    const privateEmail = ['owner', 'example.test'].join('@');
    const http = { get: jest.fn()
      .mockResolvedValueOnce({ data: { threads: [{ id: threadId, type: 'document', title: `Delivery ${privateEmail} https://private.example`, created_usec: usec('2026-07-01T00:00:00.000Z'), updated_usec: usec('2026-07-11T10:00:00.000Z'), html: '<p>Private body</p>', messages: [{ text: 'Private message' }], member_ids: ['private-member'], folders: ['private-folder'], url: 'https://private.example/thread' }], response_metadata: { next_cursor: 'next-page-cursor' } } })
      .mockResolvedValueOnce({ data: { threads: [], response_metadata: {} } }) };
    const client = new QuipWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: jest.fn(() => ({ accessToken: 'quip-token' })) } });
    const previous = { max: process.env.SNEUP_QUIP_MAX_THREADS, page: process.env.SNEUP_QUIP_PAGE_SIZE };
    process.env.SNEUP_QUIP_MAX_THREADS = '2';
    process.env.SNEUP_QUIP_PAGE_SIZE = '1';
    try {
      const result = await client.fetchDelta(account, '2026-07-01T00:00:00.000Z');
      expect(http.get).toHaveBeenNthCalledWith(1, 'https://platform.quip.com/1/users/current/threads', expect.objectContaining({
        params: { limit: 1 }, headers: { Accept: 'application/json', Authorization: 'Bearer quip-token' }, timeout: 15000, maxContentLength: 1000000, maxRedirects: 0, proxy: false
      }));
      expect(http.get).toHaveBeenNthCalledWith(2, 'https://platform.quip.com/1/users/current/threads', expect.objectContaining({ params: { limit: 1, cursor: 'next-page-cursor' } }));
      expect(http).not.toHaveProperty('post');
      const requested = http.get.mock.calls.map(call => `${call[0]} ${JSON.stringify(call[1].params)}`).join(' ');
      expect(requested).not.toMatch(/thread\/|messages|folders|members|attachments|export|html|write/i);
      expect(result).toMatchObject({ metadata: { source: 'quip_thread_metadata', threads: 1, pages: 2 }, hasMore: false });
      expect(JSON.stringify(result.records)).not.toMatch(/Private body|Private message|private-member|private-folder|private\.example|owner@example\.test/);
      expect(result.records[0]).toMatchObject({ id: `quip_thread:${threadId}`, sourceType: 'thread', threadId, threadType: 'document', status: 'open' });
      expect(result.records[0].name).not.toContain(privateEmail);
    } finally {
      if (previous.max === undefined) delete process.env.SNEUP_QUIP_MAX_THREADS; else process.env.SNEUP_QUIP_MAX_THREADS = previous.max;
      if (previous.page === undefined) delete process.env.SNEUP_QUIP_PAGE_SIZE; else process.env.SNEUP_QUIP_PAGE_SIZE = previous.page;
    }
  });

  test('rejects invalid cursors, malformed thread metadata, unsafe pagination, and collection caps', async () => {
    const accountConnectorService = { getAccountCredentials: jest.fn(() => ({ accessToken: 'quip-token' })) };
    const invalid = new QuipWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService });
    await expect(invalid.fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });

    const malformed = new QuipWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { threads: [{ id: 'https://127.0.0.1/steal', type: 'document', title: 'Private' }], response_metadata: {} } }) }, accountConnectorService });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });

    const unsafePage = new QuipWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { threads: [], response_metadata: { next_cursor: 'bad\u0000cursor' } } }) }, accountConnectorService });
    await expect(unsafePage.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });

    const previous = process.env.SNEUP_QUIP_MAX_THREADS;
    process.env.SNEUP_QUIP_MAX_THREADS = '1';
    const capped = new QuipWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { threads: [{ id: threadId, type: 'document', title: 'First' }], response_metadata: { next_cursor: 'more' } } }) }, accountConnectorService });
    try {
      await expect(capped.fetchDelta(account)).rejects.toMatchObject({ statusCode: 413 });
    } finally {
      if (previous === undefined) delete process.env.SNEUP_QUIP_MAX_THREADS; else process.env.SNEUP_QUIP_MAX_THREADS = previous;
    }
  });

  test('registers Quip as an approval-gated, read-only live adapter', () => {
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('quip');
    expect(adapter).toMatchObject({ connectorId: 'quip', capabilities: { credentialBackedSync: true, fetchDelta: true, applyAction: false } });
    expect(adapter.normalize(account, { id: `quip_thread:${threadId}`, sourceType: 'thread', threadId, threadType: 'document', name: 'Delivery notes', description: 'Private detail' })).toMatchObject({ externalId: `quip_thread:${threadId}`, description: '', url: undefined, owners: [], labels: expect.arrayContaining(['quip', 'thread', 'document']) });
  });
});
