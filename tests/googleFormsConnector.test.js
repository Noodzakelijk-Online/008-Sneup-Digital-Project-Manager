const { GoogleFormsWorkSignalClient } = require('../src/services/googleFormsWorkSignalClient');
const { getConnector } = require('../src/services/connectorRegistry');
const { buildConnectorSafetyProfile } = require('../src/services/connectorSafetyProfile');

describe('Google Forms connector', () => {
  test('uses metadata-only OAuth scope with guarded consent', () => {
    const connector = getConnector('google_forms');
    const profile = buildConnectorSafetyProfile(connector);
    expect(connector.auth).toMatchObject({ type: 'oauth2', scopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'] });
    expect(profile).toMatchObject({ scopeReviewRequired: true, providerScopeReviewRequired: false, scopeRisk: 'guarded' });
  });

  test('reads one bounded Google Forms metadata page without bodies, responses, people, or links', async () => {
    const http = { get: jest.fn().mockResolvedValue({ data: { files: [{
      id: 'form-1', name: 'Client intake private@example.test https://private.example/form', mimeType: 'application/vnd.google-apps.form', createdTime: '2026-07-10T10:00:00.000Z', modifiedTime: '2026-07-14T12:00:00.000Z',
      description: 'Private form body', owners: [{ emailAddress: 'private@example.test' }], permissions: [{ id: 'private' }], webViewLink: 'https://private.example/form', responseCount: 99
    }] } }) };
    const client = new GoogleFormsWorkSignalClient({ http, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'google-forms-token' }) } });
    const result = await client.fetchDelta({}, '2026-07-10T00:00:00.000Z');

    expect(http.get).toHaveBeenCalledWith('https://www.googleapis.com/drive/v3/files', expect.objectContaining({
      params: expect.objectContaining({ pageSize: 100, q: "mimeType = 'application/vnd.google-apps.form' and trashed = false", fields: 'files(id,name,mimeType,createdTime,modifiedTime,trashed),nextPageToken,incompleteSearch' }),
      headers: expect.objectContaining({ Authorization: 'Bearer google-forms-token' }), maxRedirects: 0, proxy: false
    }));
    expect(result.records).toEqual([expect.objectContaining({ id: 'form:form-1', sourceType: 'form', name: 'Client intake [redacted email] [redacted url]' })]);
    expect(JSON.stringify(result)).not.toMatch(/Private form body|private@example\.test|private\.example|99|google-forms-token/);
    expect(result.metadata.contentPolicy).toContain('no_form_bodies_questions_responses');
  });

  test('fails closed for invalid cursors and incomplete provider pages', async () => {
    const client = new GoogleFormsWorkSignalClient({ http: { get: jest.fn() }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'google-forms-token' }) } });
    await expect(client.fetchDelta({}, 'invalid')).rejects.toMatchObject({ statusCode: 400 });
    const capped = new GoogleFormsWorkSignalClient({ http: { get: jest.fn().mockResolvedValue({ data: { files: [{ id: 'form-1', name: 'One', mimeType: 'application/vnd.google-apps.form' }], nextPageToken: 'next' } }) }, accountConnectorService: { getAccountCredentials: () => ({ accessToken: 'google-forms-token' }) } });
    await expect(capped.fetchDelta({})).rejects.toMatchObject({ statusCode: 413 });
  });

  test('exposes a read-only adapter and normalizes only approved form metadata', () => {
    jest.dontMock('../src/services/workSignalAdapterService');
    jest.resetModules();
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(workSignalAdapterService.getAdapter('google_forms').capabilities).toMatchObject({ credentialBackedSync: true, applyAction: false });
    const normalized = workSignalAdapterService.normalize({ connectorId: 'google_forms' }, { id: 'form:form-1', formId: 'form-1', name: 'Client intake', status: 'open', updatedAt: '2026-07-14T12:00:00.000Z', body: 'Private form body', responseCount: 99, owners: ['Private owner'] });
    expect(normalized).toMatchObject({ externalId: 'form:form-1', sourceType: 'form', title: 'Client intake', description: '', url: undefined, raw: { formId: 'form-1', status: 'open' } });
    expect(JSON.stringify(normalized)).not.toMatch(/Private form body|99|Private owner/);
  });
});
