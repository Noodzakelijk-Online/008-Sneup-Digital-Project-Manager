const { GoogleWorkspaceWorkSignalClient } = require('../src/services/googleWorkspaceWorkSignalClient');

const account = { connectorId: 'google_workspace' };
const accountConnectorService = { getAccountCredentials: jest.fn(() => ({ accessToken: 'google-access-token' })) };

describe('Google Tasks through Google Workspace', () => {
  test('uses documented list reads with a readonly token and retains bounded task metadata only', async () => {
    const privateEmail = ['owner', 'example.test'].join('@');
    const http = { get: jest.fn()
      .mockResolvedValueOnce({ data: { items: [] } })
      .mockResolvedValueOnce({ data: { files: [] } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'list-1', title: `Personal ${privateEmail} https://private.example`, updated: '2026-07-11T00:00:00.000Z' }] } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'task-1', title: `Ship ${privateEmail} https://private.example`, status: 'needsAction', due: '2026-07-15T00:00:00.000Z', updated: '2026-07-12T00:00:00.000Z', notes: 'Private task note', links: [{ link: 'https://private.example' }], assignmentInfo: { surfaceType: 'SPACE' } }] } }) };
    const client = new GoogleWorkspaceWorkSignalClient({ http, accountConnectorService });
    const result = await client.fetchDelta(account, '2026-07-10T00:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith('https://tasks.googleapis.com/tasks/v1/users/@me/lists', expect.objectContaining({ params: { maxResults: 25, fields: 'items(id,title,updated),nextPageToken' }, headers: expect.objectContaining({ Authorization: 'Bearer google-access-token' }), timeout: 15000, maxContentLength: 1000000, maxBodyLength: 64 * 1024, maxRedirects: 0, proxy: false }));
    expect(http.get).toHaveBeenCalledWith('https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks', expect.objectContaining({ params: expect.objectContaining({ maxResults: 100, showCompleted: true, showDeleted: true, showHidden: true, updatedMin: '2026-07-09T23:59:00.000Z' }) }));
    expect(http).not.toHaveProperty('post');
    expect(result).toMatchObject({ hasMore: false, nextCursor: '2026-07-12T00:00:00.000Z', metadata: { taskLists: 1, tasks: 1 } });
    expect(result.records).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'google_task:list-1:task-1', externalId: 'google_tasks:list-1:task-1', sourceType: 'task', name: 'Ship [redacted email] [redacted url]', taskList: { id: 'list-1', name: 'Personal [redacted email] [redacted url]' } })]));
    expect(JSON.stringify(result.records)).not.toMatch(/Private task note|assignmentInfo|owner@example\.test|private\.example/);
  });

  test('fails closed for invalid cursors, bad task metadata, and a non-progressing task page', async () => {
    const client = new GoogleWorkspaceWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService });
    await expect(client.fetchDelta(account, 'not-a-date')).rejects.toMatchObject({ statusCode: 400 });

    const malformed = new GoogleWorkspaceWorkSignalClient({ http: { get: jest.fn()
      .mockResolvedValueOnce({ data: { items: [] } })
      .mockResolvedValueOnce({ data: { files: [] } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'list-1', title: 'Personal' }] } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'task-1', title: '' }] } }) }, accountConnectorService });
    await expect(malformed.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });

    const nonProgressing = new GoogleWorkspaceWorkSignalClient({ http: { get: jest.fn()
      .mockResolvedValueOnce({ data: { items: [] } })
      .mockResolvedValueOnce({ data: { files: [] } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'list-1', title: 'Personal' }] } })
      .mockResolvedValueOnce({ data: { items: [], nextPageToken: 'more' } }) }, accountConnectorService });
    await expect(nonProgressing.fetchDelta(account)).rejects.toMatchObject({ statusCode: 502 });
  });

  test('registers Google Tasks under the approval-gated Google Workspace adapter', () => {
    const adapter = require('../src/services/workSignalAdapterService').getAdapter('google_workspace');
    const normalized = adapter.normalize(account, { id: 'google_task:list-1:task-1', googleSource: 'tasks', sourceType: 'task', taskId: 'task-1', taskListId: 'list-1', taskList: { id: 'list-1', name: 'Personal' }, name: 'Ship', status: 'open' });
    expect(adapter.capabilities).toMatchObject({ credentialBackedSync: true, fetchDelta: true, applyAction: false });
    expect(normalized).toMatchObject({ externalId: 'google_tasks:list-1:task-1', sourceType: 'task', description: '', url: undefined, owners: [], labels: expect.arrayContaining(['google_tasks', 'task', 'Personal']) });
  });
});
