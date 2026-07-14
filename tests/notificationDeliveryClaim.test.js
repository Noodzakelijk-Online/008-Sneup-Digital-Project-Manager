const NotificationDelivery = require('../src/models/NotificationDelivery');
const { NotificationService } = require('../src/services/notificationService');

describe('notification delivery claims', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const policy = { _id: 'policy-1', workspaceId: 'workspace-1', channel: 'generic_webhook', destinationEncrypted: 'ciphertext' };
  const event = { eventType: 'reconciliation_alert', severity: 'warning', title: 'Sneup evidence gap', message: 'Operator evidence is required.' };

  test('claims a queued delivery atomically before one external request', async () => {
    const claimed = {
      _id: 'delivery-1',
      workspaceId: 'workspace-1',
      policyId: 'policy-1',
      eventType: 'reconciliation_alert',
      severity: 'warning',
      title: event.title,
      message: event.message,
      status: 'sending',
      attemptCount: 2,
      save: jest.fn().mockResolvedValue(null)
    };
    const service = new NotificationService({ http: { post: jest.fn() } });
    service.postWebhook = jest.fn().mockResolvedValue({ status: 202 });
    service.recordAudit = jest.fn().mockResolvedValue(null);
    const claim = jest.spyOn(NotificationDelivery, 'findOneAndUpdate').mockResolvedValue(claimed);

    const result = await service.deliverExisting(policy, { _id: 'delivery-1', workspaceId: 'workspace-1', status: 'queued' }, event, 'notification-worker');

    expect(claim).toHaveBeenCalledWith({
      _id: 'delivery-1',
      workspaceId: 'workspace-1',
      status: { $in: ['queued', 'deferred'] }
    }, {
      $set: { status: 'sending', claimedAt: expect.any(Date) },
      $inc: { attemptCount: 1 }
    }, { new: true });
    expect(service.postWebhook).toHaveBeenCalledTimes(1);
    expect(claimed.status).toBe('delivered');
    expect(claimed.attemptCount).toBe(2);
    expect(claimed.save).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('delivered');
  });

  test('does not issue a duplicate request when another worker already owns a delivery', async () => {
    const service = new NotificationService({ http: { post: jest.fn() } });
    service.postWebhook = jest.fn();
    const claim = jest.spyOn(NotificationDelivery, 'findOneAndUpdate').mockResolvedValue(null);

    const result = await service.deliverExisting(policy, {
      _id: 'delivery-1', workspaceId: 'workspace-1', policyId: 'policy-1', eventType: 'reconciliation_alert', severity: 'warning', title: event.title, message: event.message, status: 'sending'
    }, event, 'notification-worker');

    expect(claim).toHaveBeenCalledTimes(1);
    expect(service.postWebhook).not.toHaveBeenCalled();
    expect(result.status).toBe('in_progress');
  });
});
