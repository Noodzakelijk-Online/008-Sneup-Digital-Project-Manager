const { ProofHubWorkSignalClient } = require('../src/services/proofHubWorkSignalClient');

const account = {
  connectorId: 'proofhub',
  metadata: { fields: { tenantUrl: 'https://example.proofhub.com' } }
};
const credentials = { getAccountCredentials: jest.fn(() => ({ apiKey: 'proofhub-token' })) };

describe('ProofHub connector hardening', () => {
  test('uses header authentication, request pacing, response limits, and redacted metadata only', async () => {
    const privateEmail = ['owner', 'example.test'].join('@');
    const sleep = jest.fn(() => Promise.resolve());
    const http = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: [{ id: '9', title: `Release ${privateEmail} https://private.example`, archived: false, description: 'Private project description', created_at: '2026-07-01T00:00:00.000Z', modified_at: '2026-07-02T00:00:00.000Z' }] })
        .mockResolvedValueOnce({ data: [{ id: '18', title: `Sprint ${privateEmail} https://private.example`, private: false, archived: false, description: 'Private list description', created_at: '2026-07-02T00:00:00.000Z', modified_at: '2026-07-03T00:00:00.000Z' }, { id: '19', title: 'Private list', private: true }] })
        .mockResolvedValueOnce({ data: [{ id: '27', title: `Ship ${privateEmail} https://private.example`, completed: false, due_date: '2026-07-10T00:00:00.000Z', description: 'Private task description', assigned: [{ name: 'Private owner' }], custom_fields: [{ value: 'Private custom value' }], created_at: '2026-07-03T00:00:00.000Z', updated_at: '2026-07-04T00:00:00.000Z' }, { id: '28', title: 'Private task', private: true }] })
    };
    const client = new ProofHubWorkSignalClient({ http, sleep, accountConnectorService: credentials });
    const result = await client.fetchDelta(account);

    expect(http.get).toHaveBeenCalledWith('https://example.proofhub.com/api/v3/projects', expect.objectContaining({
      headers: expect.objectContaining({ 'X-API-KEY': 'proofhub-token', 'User-Agent': expect.stringContaining('Sneup Project Manager') }),
      timeout: 15000,
      maxContentLength: 1000000,
      maxBodyLength: 64 * 1024,
      maxRedirects: 0,
      proxy: false
    }));
    expect(http.get).toHaveBeenCalledWith('https://example.proofhub.com/api/v3/projects/9/todolists', expect.any(Object));
    expect(http.get).toHaveBeenCalledWith('https://example.proofhub.com/api/v3/projects/9/todolists/18/tasks', expect.any(Object));
    expect(sleep).toHaveBeenCalled();
    expect(http).not.toHaveProperty('post');

    const task = result.records.find(record => record.id === 'task:27');
    expect(task).toMatchObject({ id: 'task:27', name: 'Ship [redacted email] [redacted url]' });
    expect(result.records.map(record => record.id)).not.toEqual(expect.arrayContaining(['task_list:19', 'task:28']));
    expect(JSON.stringify(result.records)).not.toMatch(/Private project description|Private list description|Private task description|Private owner|Private custom value|owner@example\.test|private\.example/);
    expect(result.metadata.contentPolicy).toContain('no_descriptions_comments_files_custom_fields_people_provider_urls_or_writes');
  });

  test('fails closed for invalid tenants, cursors, and provider metadata', async () => {
    const client = new ProofHubWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: credentials });
    await expect(client.fetchDelta({ metadata: { fields: { tenantUrl: 'http://127.0.0.1' } } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(client.fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });

    const malformed = new ProofHubWorkSignalClient({
      http: { get: jest.fn().mockResolvedValue({ data: [{ id: 'not-an-id', title: 'Broken' }] }) },
      accountConnectorService: credentials
    });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
  });

  test('does not let response-size configuration exceed the hard limit', () => {
    const previous = process.env.SNEUP_PROOFHUB_MAX_RESPONSE_BYTES;
    process.env.SNEUP_PROOFHUB_MAX_RESPONSE_BYTES = '99999999';
    try {
      const config = new ProofHubWorkSignalClient({ accountConnectorService: credentials }).getConfig(account);
      expect(config.maxResponseBytes).toBe(5000000);
      expect(config.minIntervalMs).toBe(500);
    } finally {
      if (previous === undefined) delete process.env.SNEUP_PROOFHUB_MAX_RESPONSE_BYTES;
      else process.env.SNEUP_PROOFHUB_MAX_RESPONSE_BYTES = previous;
    }
  });
});
