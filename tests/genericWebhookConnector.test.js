const crypto = require('crypto');
const { GenericWebhookService, getMaxBodyBytes, isGenericWebhookPath } = require('../src/services/genericWebhookService');

const ACCOUNT_ID = '507f1f77bcf86cd799439011';
const WORKSPACE_ID = '507f191e810c19729de860ea';
const sign = (rawBody, secret) => `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;

describe('Generic Webhook connector', () => {
  const secret = 'webhook-signing-secret';
  let ConnectorAccount;
  let workSignalService;
  let operationsLedgerService;
  let service;

  beforeEach(() => {
    ConnectorAccount = { findOne: jest.fn().mockResolvedValue({
      _id: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      connectorId: 'webhook_generic',
      status: 'connected'
    }) };
    workSignalService = { upsertProviderRecord: jest.fn().mockResolvedValue({ id: 'signal-1' }) };
    operationsLedgerService = { recordAudit: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
    service = new GenericWebhookService({
      ConnectorAccount,
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ signingSecret: secret })) },
      workSignalService,
      operationsLedgerService
    });
  });

  test('accepts a correctly signed allowlisted event and does not persist arbitrary content', async () => {
    const body = {
      id: 'release:2026-07-23',
      title: 'Release by owner@example.test https://private.example/release',
      type: 'project',
      status: 'in_progress',
      priority: 'high',
      occurredAt: '2026-07-23T10:00:00.000Z',
      updatedAt: '2026-07-23T10:10:00.000Z',
      description: 'Private detail',
      url: 'https://private.example',
      owners: ['Private owner'],
      arbitrary: { token: 'secret' }
    };
    const rawBody = Buffer.from(JSON.stringify(body));

    const result = await service.ingest({ accountId: ACCOUNT_ID, rawBody, body, signature: sign(rawBody, secret) });

    expect(result).toEqual({ event: expect.objectContaining({ id: body.id, title: 'Release by [redacted email] [redacted url]' }), signal: { id: 'signal-1' } });
    expect(workSignalService.upsertProviderRecord).toHaveBeenCalledWith(ACCOUNT_ID, {
      id: body.id,
      title: 'Release by [redacted email] [redacted url]',
      type: 'project',
      status: 'in_progress',
      priority: 'high',
      occurredAt: body.occurredAt,
      updatedAt: body.updatedAt
    }, expect.objectContaining({ workspaceId: WORKSPACE_ID, actorId: 'generic-webhook' }));
    expect(operationsLedgerService.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'generic_webhook_signal_received',
      afterState: expect.objectContaining({ signalId: 'signal-1', sourceType: 'project' })
    }));
    expect(JSON.stringify(operationsLedgerService.recordAudit.mock.calls)).not.toMatch(/Private detail|private\.example|Private owner|secret/);
  });

  test('fails closed for missing or invalid HMAC signatures before upserting a signal', async () => {
    const body = { id: 'task:1', title: 'Ship safely' };
    const rawBody = Buffer.from(JSON.stringify(body));

    await expect(service.ingest({ accountId: ACCOUNT_ID, rawBody, body, signature: 'sha256=bad' })).rejects.toMatchObject({ statusCode: 401, code: 'invalid_signature' });
    expect(workSignalService.upsertProviderRecord).not.toHaveBeenCalled();
  });

  test('verifies the raw HMAC before decoding a raw JSON request body', async () => {
    const rawBody = Buffer.from('{"id":"task:1","title":"Verified raw payload"}');

    await service.ingest({ accountId: ACCOUNT_ID, rawBody, body: rawBody, signature: sign(rawBody, secret) });
    expect(workSignalService.upsertProviderRecord).toHaveBeenCalledWith(ACCOUNT_ID, expect.objectContaining({
      id: 'task:1',
      title: 'Verified raw payload'
    }), expect.any(Object));

    const malformed = Buffer.from('{"id":');
    await expect(service.ingest({ accountId: ACCOUNT_ID, rawBody: malformed, body: malformed, signature: sign(malformed, secret) })).rejects.toMatchObject({
      statusCode: 400,
      code: 'invalid_payload'
    });
  });

  test('rejects invalid account ids, oversized bodies, and invalid payload identifiers', async () => {
    await expect(service.ingest({ accountId: 'invalid', rawBody: Buffer.from('{}'), body: {}, signature: 'sha256=bad' })).rejects.toMatchObject({ statusCode: 404 });
    const tooLarge = Buffer.alloc(getMaxBodyBytes() + 1, 'a');
    await expect(service.ingest({ accountId: ACCOUNT_ID, rawBody: tooLarge, body: { id: 'task:1', title: 'Too large' }, signature: sign(tooLarge, secret) })).rejects.toMatchObject({ statusCode: 413 });
    const body = { id: '../../bad', title: 'Invalid identifier' };
    const rawBody = Buffer.from(JSON.stringify(body));
    await expect(service.ingest({ accountId: ACCOUNT_ID, rawBody, body, signature: sign(rawBody, secret) })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('exposes Generic Webhook as an inbound-only read-only adapter path', () => {
    const { getConnector } = require('../src/services/connectorRegistry');
    const workSignalAdapterService = require('../src/services/workSignalAdapterService');
    expect(getConnector('webhook_generic')).toMatchObject({ sync: ['inbound_events'], auth: { type: 'manual' } });
    expect(getConnector('webhook_generic').auth.fields.find(field => field.name === 'signingSecret')).toMatchObject({ secret: true, required: true });
    expect(workSignalAdapterService.getAdapter('webhook_generic').capabilities).toMatchObject({ credentialBackedSync: true, inboundWebhook: true, fetchDelta: false, applyAction: false });
    const normalized = workSignalAdapterService.normalize({ connectorId: 'webhook_generic' }, {
      id: 'task:1', title: 'Bounded event', type: 'task', status: 'open', priority: 'normal',
      description: 'Private detail', url: 'https://private.example', owners: ['Private owner']
    });
    expect(normalized).toMatchObject({ description: '', url: undefined, owners: [], raw: { eventId: 'task:1' } });
    expect(JSON.stringify(normalized)).not.toMatch(/Private detail|private\.example|Private owner/);
    expect(isGenericWebhookPath(`/api/webhooks/generic/${ACCOUNT_ID}`)).toBe(true);
    expect(isGenericWebhookPath(`/api/webhooks/generic/${ACCOUNT_ID}?source=provider`)).toBe(true);
    expect(isGenericWebhookPath('/api/webhooks/generic/not-an-id')).toBe(false);
  });
});
