const { FreedcampWorkSignalClient } = require('../src/services/freedcampWorkSignalClient');

const account = { connectorId: 'freedcamp' };
const credentials = { getAccountCredentials: jest.fn(() => ({ apiKey: 'freedcamp-token' })) };

describe('Freedcamp connector hardening', () => {
  test('uses header authentication, response limits, and redacted metadata only', async () => {
    const privateEmail = ['owner', 'example.test'].join('@');
    const http = { get: jest.fn()
      .mockResolvedValueOnce({ data: { data: { projects: [{ project_id: '9', project_name: `Release ${privateEmail} https://private.example`, project_description: 'Private project description' }] } } })
      .mockResolvedValueOnce({ data: { data: { tasks: [{ id: '18', project_id: '9', title: `Ship ${privateEmail} https://private.example`, status_title: 'In progress', priority_title: 'High', assigned_to_fullname: 'Private owner', url: 'https://freedcamp.com/private', description: 'Private task description' }], meta: { has_more: false } } } })
      .mockResolvedValueOnce({ data: { data: { milestones: [], meta: { has_more: false } } } }) };
    const client = new FreedcampWorkSignalClient({ http, accountConnectorService: credentials });
    const result = await client.fetchDelta(account);

    expect(http.get).toHaveBeenCalledWith('https://freedcamp.com/api/v1/tasks', expect.objectContaining({ params: { limit: 200, offset: 0 }, headers: expect.objectContaining({ 'X-API-KEY': 'freedcamp-token' }), timeout: 15000, maxContentLength: 1000000, maxBodyLength: 64 * 1024, maxRedirects: 0, proxy: false }));
    expect(http).not.toHaveProperty('post');
    const task = result.records.find(record => record.id === 'task:18');
    expect(task).toMatchObject({ id: 'task:18', name: 'Ship [redacted email] [redacted url]' });
    expect(task).not.toHaveProperty('owners');
    expect(task).not.toHaveProperty('url');
    expect(JSON.stringify(result.records)).not.toMatch(/Private project description|Private task description|Private owner|owner@example\.test|private\.example|freedcamp\.com\/private/);
    expect(result.metadata.contentPolicy).toContain('no_descriptions_comments_files_custom_fields_tags_people_or_provider_urls_or_writes');
  });

  test('fails closed for an invalid cursor, malformed metadata, and a non-progressing page', async () => {
    const getAccountCredentials = jest.fn(() => ({ apiKey: 'freedcamp-token' }));
    const client = new FreedcampWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: { getAccountCredentials } });
    await expect(client.fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });

    const malformed = new FreedcampWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { data: { projects: [{ project_id: 'not-an-id', project_name: 'Broken' }] } } }) }, accountConnectorService: { getAccountCredentials } });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });

    const nonProgressing = new FreedcampWorkSignalClient({ http: { get: jest.fn()
      .mockResolvedValueOnce({ data: { data: { projects: [] } } })
      .mockResolvedValueOnce({ data: { data: { tasks: [], meta: { has_more: true } } } }) }, accountConnectorService: { getAccountCredentials } });
    await expect(nonProgressing.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
  });

  test('does not let response-size configuration exceed the hard limit', () => {
    const previous = process.env.SNEUP_FREEDCAMP_MAX_RESPONSE_BYTES;
    process.env.SNEUP_FREEDCAMP_MAX_RESPONSE_BYTES = '99999999';
    try {
      const config = new FreedcampWorkSignalClient({ accountConnectorService: credentials }).getConfig();
      expect(config.maxResponseBytes).toBe(5000000);
    } finally {
      if (previous === undefined) delete process.env.SNEUP_FREEDCAMP_MAX_RESPONSE_BYTES;
      else process.env.SNEUP_FREEDCAMP_MAX_RESPONSE_BYTES = previous;
    }
  });
});
