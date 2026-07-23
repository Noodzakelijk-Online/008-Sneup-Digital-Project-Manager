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
  let WebhookDelivery;
  let service;

  beforeEach(() => {
    ConnectorAccount = { findOne: jest.fn().mockResolvedValue({
      _id: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      connectorId: 'webhook_generic',
      status: 'connected'
    }) };
    workSignalService = { upsertProviderRecord: jest.fn().mockResolvedValue({ id: 'signal-1' }) };
    operationsLedgerService = {
      recordAudit: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      recordChatWorkerResponse: jest.fn().mockResolvedValue({
        recorded: true,
        response: { id: 'worker-response-1' },
        interventionId: 'intervention-1'
      })
    };
    WebhookDelivery = {
      findOneAndUpdate: jest.fn(),
      findOne: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true })
    };
    service = new GenericWebhookService({
      ConnectorAccount,
      accountConnectorService: { getAccountCredentials: jest.fn(() => ({ signingSecret: secret })) },
      workSignalService,
      operationsLedgerService,
      WebhookDelivery
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

  test('deduplicates a retried provider delivery without replaying the signal or audit event', async () => {
    const body = { id: 'task:1', title: 'Ship safely' };
    const rawBody = Buffer.from(JSON.stringify(body));
    WebhookDelivery.findOneAndUpdate
      .mockResolvedValueOnce({ _id: 'delivery-1', status: 'processing' })
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: 11000 }));
    WebhookDelivery.findOne.mockResolvedValue({ _id: 'delivery-1', status: 'succeeded', signalId: 'signal-1' });

    const first = await service.ingest({
      accountId: ACCOUNT_ID,
      rawBody,
      body,
      signature: sign(rawBody, secret),
      deliveryId: 'provider:delivery-1'
    });
    const retry = await service.ingest({
      accountId: ACCOUNT_ID,
      rawBody,
      body,
      signature: sign(rawBody, secret),
      deliveryId: 'provider:delivery-1'
    });

    expect(first).toMatchObject({ duplicate: false, signal: { id: 'signal-1' } });
    expect(retry).toMatchObject({ duplicate: true, processing: false, signal: { id: 'signal-1' } });
    expect(workSignalService.upsertProviderRecord).toHaveBeenCalledTimes(1);
    expect(operationsLedgerService.recordAudit).toHaveBeenCalledTimes(1);
    expect(WebhookDelivery.updateOne).toHaveBeenCalledWith({ _id: 'delivery-1' }, expect.objectContaining({
      $set: expect.objectContaining({ status: 'succeeded', signalId: 'signal-1' })
    }));
  });

  test('accepts an exactly mapped, signed inbound worker response without retaining its text in webhook evidence', async () => {
    const body = {
      id: 'slack:message-1',
      source: 'slack',
      sourceMemberId: 'U12345',
      sourceCardId: 'thread:67890',
      responseType: 'completed',
      responseText: 'Finished the private client work.'
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    ConnectorAccount.findOne.mockResolvedValueOnce({
      _id: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      connectorId: 'webhook_generic',
      status: 'connected',
      metadata: {
        workerResponseBindings: [{
          source: 'slack',
          sourceMemberId: 'U12345',
          sourceCardId: 'thread:67890',
          memberId: '507f1f77bcf86cd799439012',
          cardId: '507f1f77bcf86cd799439013'
        }]
      }
    });
    WebhookDelivery.findOneAndUpdate.mockResolvedValue({ _id: 'delivery-response-1', status: 'processing' });

    const result = await service.ingestWorkerResponse({
      accountId: ACCOUNT_ID,
      rawBody,
      body,
      signature: sign(rawBody, secret)
    });

    expect(result).toEqual({
      event: { id: 'slack:message-1' },
      workerResponse: { id: 'worker-response-1', recorded: true },
      duplicate: false,
      processing: false
    });
    expect(operationsLedgerService.recordChatWorkerResponse).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: WORKSPACE_ID,
      memberId: '507f1f77bcf86cd799439012',
      cardId: '507f1f77bcf86cd799439013',
      responseType: 'completed',
      source: 'slack',
      actor: `connector:${ACCOUNT_ID}`
    }));
    expect(operationsLedgerService.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'generic_webhook_worker_response_recorded',
      afterState: expect.objectContaining({ eventId: 'slack:message-1', source: 'slack', workerResponseId: 'worker-response-1' })
    }));
    expect(JSON.stringify(operationsLedgerService.recordAudit.mock.calls)).not.toMatch(/private client work/i);
    expect(WebhookDelivery.updateOne).toHaveBeenCalledWith({ _id: 'delivery-response-1' }, expect.objectContaining({
      $set: expect.objectContaining({ status: 'succeeded', workerResponseId: 'worker-response-1' })
    }));
  });

  test('rejects an unmapped inbound worker response before it reaches the ledger', async () => {
    const body = {
      id: 'slack:message-unmapped',
      source: 'slack',
      sourceMemberId: 'U12345',
      sourceCardId: 'thread:67890',
      responseType: 'completed',
      responseText: 'Done'
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    ConnectorAccount.findOne.mockResolvedValueOnce({
      _id: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      connectorId: 'webhook_generic',
      status: 'connected',
      metadata: { workerResponseBindings: [] }
    });

    await expect(service.ingestWorkerResponse({
      accountId: ACCOUNT_ID,
      rawBody,
      body,
      signature: sign(rawBody, secret)
    })).rejects.toMatchObject({ statusCode: 403, code: 'not_configured' });
    expect(operationsLedgerService.recordChatWorkerResponse).not.toHaveBeenCalled();
    expect(WebhookDelivery.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('does not resolve a response through a binding from another source', async () => {
    const body = {
      id: 'teams:message-unmapped',
      source: 'teams',
      sourceMemberId: 'U12345',
      sourceCardId: 'thread:67890',
      responseType: 'completed',
      responseText: 'Done'
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    ConnectorAccount.findOne.mockResolvedValueOnce({
      _id: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      connectorId: 'webhook_generic',
      status: 'connected',
      metadata: {
        workerResponseBindings: [{
          source: 'slack',
          sourceMemberId: 'U12345',
          sourceCardId: 'thread:67890',
          memberId: '507f1f77bcf86cd799439012',
          cardId: '507f1f77bcf86cd799439013'
        }]
      }
    });

    await expect(service.ingestWorkerResponse({
      accountId: ACCOUNT_ID,
      rawBody,
      body,
      signature: sign(rawBody, secret)
    })).rejects.toMatchObject({ statusCode: 403, code: 'not_configured' });
    expect(operationsLedgerService.recordChatWorkerResponse).not.toHaveBeenCalled();
    expect(WebhookDelivery.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('validates configured bindings against members assigned to their mapped cards', async () => {
    const account = {
      _id: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      connectorId: 'webhook_generic',
      status: 'connected',
      metadata: {},
      save: jest.fn().mockResolvedValue(null)
    };
    const configured = new GenericWebhookService({
      ConnectorAccount: { findOne: jest.fn().mockResolvedValue(account) },
      Member: { find: jest.fn().mockResolvedValue([{ _id: '507f1f77bcf86cd799439012' }]) },
      Card: { find: jest.fn().mockResolvedValue([{ _id: '507f1f77bcf86cd799439013', members: ['507f1f77bcf86cd799439012'] }]) },
      accountConnectorService: { getAccountCredentials: jest.fn() },
      workSignalService,
      operationsLedgerService,
      WebhookDelivery
    });
    const bindings = [{
      source: 'slack',
      sourceMemberId: 'U12345',
      sourceCardId: 'thread:67890',
      memberId: '507f1f77bcf86cd799439012',
      cardId: '507f1f77bcf86cd799439013'
    }];

    await expect(configured.configureWorkerResponseBindings({
      accountId: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      actor: 'admin-1',
      bindings
    })).resolves.toEqual(bindings);
    expect(account.save).toHaveBeenCalledTimes(1);
    expect(operationsLedgerService.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'generic_webhook_worker_response_bindings_configured',
      afterState: { connectorId: 'webhook_generic', bindingCount: 1 }
    }));

    await expect(configured.configureWorkerResponseBindings({
      accountId: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      bindings: [{ ...bindings[0], cardId: '507f1f77bcf86cd799439014' }]
    })).rejects.toMatchObject({ statusCode: 400, code: 'invalid_payload' });
  });

  test('lists shallow, bounded mapping options without exposing member emails or card descriptions', async () => {
    const queryResult = (values) => {
      const result = {};
      result.select = jest.fn(() => result);
      result.sort = jest.fn(() => result);
      result.limit = jest.fn().mockResolvedValue(values);
      return result;
    };
    const Member = { find: jest.fn(() => queryResult([{ _id: '507f1f77bcf86cd799439012', fullName: 'Alex Operator', username: 'alex', email: 'private@example.test' }])) };
    const Card = { find: jest.fn(() => queryResult([{ _id: '507f1f77bcf86cd799439013', name: 'Deliver release', closed: false, description: 'Do not return this.' }])) };
    const optionsService = new GenericWebhookService({
      ConnectorAccount: { findOne: jest.fn().mockResolvedValue({ _id: ACCOUNT_ID, workspaceId: WORKSPACE_ID, connectorId: 'webhook_generic', status: 'connected' }) },
      Member,
      Card,
      accountConnectorService: { getAccountCredentials: jest.fn() },
      workSignalService,
      operationsLedgerService,
      WebhookDelivery
    });

    await expect(optionsService.getWorkerResponseBindingOptions({
      accountId: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      memberId: '507f1f77bcf86cd799439012',
      query: 'Alex',
      limit: 999
    })).resolves.toEqual({
      members: [{ id: '507f1f77bcf86cd799439012', name: 'Alex Operator', username: 'alex' }],
      cards: [{ id: '507f1f77bcf86cd799439013', name: 'Deliver release', closed: false }]
    });
    expect(Member.find).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WORKSPACE_ID, $or: expect.any(Array) }));
    expect(Card.find).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID, members: '507f1f77bcf86cd799439012' });
  });

  test('rejects invalid delivery identifiers before creating a signal', async () => {
    const body = { id: 'task:1', title: 'Ship safely' };
    const rawBody = Buffer.from(JSON.stringify(body));

    await expect(service.ingest({
      accountId: ACCOUNT_ID,
      rawBody,
      body,
      signature: sign(rawBody, secret),
      deliveryId: 'not allowed spaces'
    })).rejects.toMatchObject({ statusCode: 400, code: 'invalid_payload' });
    expect(workSignalService.upsertProviderRecord).not.toHaveBeenCalled();
    expect(WebhookDelivery.findOneAndUpdate).not.toHaveBeenCalled();
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
    expect(isGenericWebhookPath(`/api/webhooks/generic/${ACCOUNT_ID}/worker-response`)).toBe(true);
    expect(isGenericWebhookPath('/api/webhooks/generic/not-an-id')).toBe(false);
  });
});
