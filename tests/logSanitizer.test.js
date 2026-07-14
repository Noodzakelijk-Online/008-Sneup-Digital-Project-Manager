const { OMITTED, REDACTED, sanitizeLogInfo, sanitizeText } = require('../src/utils/logSanitizer');

describe('log sanitizer', () => {
  test('redacts credential-bearing provider metadata and omits retained work content', () => {
    const result = sanitizeLogInfo({
      message: 'Connector sync failed',
      authorization: 'Bearer top-secret-token',
      request: {
        headers: {
          'x-api-key': 'provider-api-key',
          cookie: 'session=private'
        },
        params: {
          token: 'query-token',
          page: 2
        },
        payload: { description: 'Private project details' }
      },
      responseText: 'The customer contract is delayed'
    });

    expect(result.message).toBe('Connector sync failed');
    expect(result.authorization).toBe(REDACTED);
    expect(result.request.headers['x-api-key']).toBe(REDACTED);
    expect(result.request.headers.cookie).toBe(REDACTED);
    expect(result.request.params.token).toBe(REDACTED);
    expect(result.request.params.page).toBe(2);
    expect(result.request.payload).toBe(OMITTED);
    expect(result.responseText).toBe(OMITTED);
  });

  test('reduces Error objects to diagnostic-safe metadata without request configuration', () => {
    const error = new Error('Provider rejected card description: confidential client plan');
    error.code = 'ERR_BAD_REQUEST';
    error.status = 400;
    error.config = {
      headers: { Authorization: 'Bearer provider-token' },
      data: { text: 'private work update' }
    };

    const result = sanitizeLogInfo({ event: 'provider_sync_failed', error });

    expect(result.error).toEqual(expect.objectContaining({
      name: 'Error',
      code: 'ERR_BAD_REQUEST',
      status: 400
    }));
    expect(JSON.stringify(result)).not.toContain('confidential client plan');
    expect(JSON.stringify(result)).not.toContain('provider-token');
    expect(JSON.stringify(result)).not.toContain('private work update');
  });

  test('redacts credential fragments embedded in otherwise safe diagnostic text', () => {
    const result = sanitizeText('GET /v1/tasks?apiKey=raw-key Authorization: Bearer long-token');

    expect(result).not.toContain('raw-key');
    expect(result).not.toContain('long-token');
    expect(result).toContain(REDACTED);
  });
});
