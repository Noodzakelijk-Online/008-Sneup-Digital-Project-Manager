const crypto = require('crypto');
const mongoose = require('mongoose');
const ConnectorAccount = require('../models/ConnectorAccount');
const WebhookDelivery = require('../models/WebhookDelivery');
const accountConnectorService = require('./accountConnectorService');
const operationsLedgerService = require('./operationsLedgerService');
const workSignalService = require('./workSignalService');

const DEFAULT_MAX_BODY_BYTES = 32 * 1024;
const MAX_BODY_BYTES = 256 * 1024;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const DELIVERY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SIGNATURE_PATTERN = /^sha256=([a-f0-9]{64})$/i;
const DEFAULT_DELIVERY_LEASE_MS = 2 * 60 * 1000;
const DEFAULT_DELIVERY_RETENTION_DAYS = 14;

const getMaxBodyBytes = () => {
  const configured = Number.parseInt(process.env.SNEUP_GENERIC_WEBHOOK_MAX_BODY_BYTES, 10);
  if (!Number.isFinite(configured)) return DEFAULT_MAX_BODY_BYTES;
  return Math.max(1024, Math.min(configured, MAX_BODY_BYTES));
};

const boundedInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
};

const getDeliveryLeaseMs = () => boundedInteger(
  process.env.SNEUP_GENERIC_WEBHOOK_DELIVERY_LEASE_MS,
  DEFAULT_DELIVERY_LEASE_MS,
  10 * 1000,
  10 * 60 * 1000
);

const getDeliveryRetentionMs = () => boundedInteger(
  process.env.SNEUP_GENERIC_WEBHOOK_DELIVERY_RETENTION_DAYS,
  DEFAULT_DELIVERY_RETENTION_DAYS,
  1,
  31
) * 24 * 60 * 60 * 1000;

const isGenericWebhookPath = (path) => /^\/api\/webhooks\/generic\/[a-f\d]{24}$/i.test(String(path || '').split('?')[0]);

const webhookError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const sanitizeTitle = (value) => String(value || '')
  .replace(/https?:\/\/\S+/gi, '[redacted url]')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 160);

const optionalDate = (value, name) => {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw webhookError(`${name} must be a valid timestamp`, 400, 'invalid_payload');
  }
  return date.toISOString();
};

class GenericWebhookService {
  constructor(dependencies = {}) {
    this.ConnectorAccount = dependencies.ConnectorAccount || ConnectorAccount;
    this.WebhookDelivery = dependencies.WebhookDelivery || WebhookDelivery;
    this.accountConnectorService = dependencies.accountConnectorService || accountConnectorService;
    this.operationsLedgerService = dependencies.operationsLedgerService || operationsLedgerService;
    this.workSignalService = dependencies.workSignalService || workSignalService;
  }

  getMaxBodyBytes() {
    return getMaxBodyBytes();
  }

  verifySignature(rawBody, providedSignature, signingSecret) {
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      throw webhookError('Webhook signature is invalid', 401, 'invalid_signature');
    }
    if (rawBody.length > this.getMaxBodyBytes()) {
      throw webhookError('Webhook payload is too large', 413, 'payload_too_large');
    }
    const match = String(providedSignature || '').trim().match(SIGNATURE_PATTERN);
    if (!match || !signingSecret) {
      throw webhookError('Webhook signature is invalid', 401, 'invalid_signature');
    }

    const expected = crypto.createHmac('sha256', String(signingSecret)).update(rawBody).digest('hex');
    const supplied = Buffer.from(match[1].toLowerCase(), 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (supplied.length !== expectedBuffer.length || !crypto.timingSafeEqual(supplied, expectedBuffer)) {
      throw webhookError('Webhook signature is invalid', 401, 'invalid_signature');
    }
  }

  parsePayload(rawBody) {
    try {
      return JSON.parse(rawBody.toString('utf8'));
    } catch (error) {
      throw webhookError('Webhook payload must be valid JSON', 400, 'invalid_payload');
    }
  }

  normalizeEvent(payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw webhookError('Webhook payload must be an object', 400, 'invalid_payload');
    }

    const id = String(payload.id || '').trim();
    const title = sanitizeTitle(payload.title);
    if (!ID_PATTERN.test(id)) {
      throw webhookError('Webhook payload id is invalid', 400, 'invalid_payload');
    }
    if (!title) {
      throw webhookError('Webhook payload title is required', 400, 'invalid_payload');
    }

    const type = String(payload.type || 'task').trim().slice(0, 40);
    const status = String(payload.status || 'open').trim().slice(0, 40);
    const priority = String(payload.priority || 'unknown').trim().slice(0, 40);
    return {
      id,
      title,
      type,
      status,
      priority,
      occurredAt: optionalDate(payload.occurredAt, 'occurredAt'),
      updatedAt: optionalDate(payload.updatedAt, 'updatedAt')
    };
  }

  normalizeDeliveryId(deliveryId) {
    if (deliveryId === undefined || deliveryId === null || deliveryId === '') return null;
    const normalized = String(deliveryId).trim();
    if (!DELIVERY_ID_PATTERN.test(normalized)) {
      throw webhookError('Webhook delivery id is invalid', 400, 'invalid_payload');
    }
    return normalized;
  }

  async claimDelivery(account, deliveryId) {
    if (!deliveryId) return { acquired: true, delivery: null };

    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + getDeliveryLeaseMs());
    const expiresAt = new Date(now.getTime() + getDeliveryRetentionMs());
    const query = {
      connectorAccountId: account._id,
      deliveryId,
      $or: [
        { status: { $exists: false } },
        { status: 'failed' },
        { status: 'processing', leaseExpiresAt: { $lte: now } }
      ]
    };

    try {
      const result = await this.WebhookDelivery.findOneAndUpdate(query, {
        $set: { status: 'processing', leaseExpiresAt, expiresAt },
        $setOnInsert: {
          workspaceId: account.workspaceId,
          connectorAccountId: account._id,
          deliveryId
        },
        $unset: { signalId: 1, processedAt: 1 },
        $inc: { attemptCount: 1 }
      }, {
        upsert: true,
        new: true,
        includeResultMetadata: true,
        setDefaultsOnInsert: true
      });
      return { acquired: true, delivery: result.value || result };
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const delivery = await this.WebhookDelivery.findOne({
        connectorAccountId: account._id,
        deliveryId
      });
      if (!delivery) throw error;
      return { acquired: false, delivery };
    }
  }

  async finalizeDelivery(delivery, status, signalId) {
    if (!delivery?._id) return;
    const update = {
      status,
      leaseExpiresAt: undefined,
      processedAt: new Date()
    };
    if (signalId) update.signalId = signalId;
    await this.WebhookDelivery.updateOne({ _id: delivery._id }, { $set: update });
  }

  async ingest({ accountId, rawBody, body, signature, deliveryId }) {
    if (!mongoose.isValidObjectId(accountId)) {
      throw webhookError('Webhook endpoint is not configured', 404, 'not_configured');
    }
    const account = await this.ConnectorAccount.findOne({
      _id: accountId,
      connectorId: 'webhook_generic',
      status: 'connected'
    });
    if (!account) {
      throw webhookError('Webhook endpoint is not configured', 404, 'not_configured');
    }

    const credentials = this.accountConnectorService.getAccountCredentials(account);
    this.verifySignature(rawBody, signature, credentials.signingSecret);
    const event = this.normalizeEvent(Buffer.isBuffer(body) ? this.parsePayload(rawBody) : body);
    const normalizedDeliveryId = this.normalizeDeliveryId(deliveryId);
    const claimed = await this.claimDelivery(account, normalizedDeliveryId);
    if (!claimed.acquired) {
      return {
        event,
        signal: { id: claimed.delivery.signalId || null },
        duplicate: true,
        processing: claimed.delivery.status === 'processing'
      };
    }

    let signal;
    try {
      signal = await this.workSignalService.upsertProviderRecord(account._id, event, {
        workspaceId: account.workspaceId,
        actorId: 'generic-webhook'
      });

      await this.operationsLedgerService.recordAudit({
        workspaceId: account.workspaceId,
        entityType: 'connector_webhook',
        entityId: account._id,
        action: 'generic_webhook_signal_received',
        actor: 'generic-webhook',
        source: 'system',
        riskLevel: 'low',
        afterState: {
          connectorId: 'webhook_generic',
          connectorAccountId: String(account._id),
          signalId: signal.id,
          sourceType: event.type,
          status: event.status,
          priority: event.priority
        }
      });
    } catch (error) {
      await this.finalizeDelivery(claimed.delivery, 'failed');
      throw error;
    }

    await this.finalizeDelivery(claimed.delivery, 'succeeded', signal.id);

    return normalizedDeliveryId
      ? { event, signal, duplicate: false, processing: false }
      : { event, signal };
  }
}

module.exports = new GenericWebhookService();
module.exports.GenericWebhookService = GenericWebhookService;
module.exports.getMaxBodyBytes = getMaxBodyBytes;
module.exports.isGenericWebhookPath = isGenericWebhookPath;
