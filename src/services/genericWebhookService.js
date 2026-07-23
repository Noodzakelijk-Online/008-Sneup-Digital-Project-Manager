const crypto = require('crypto');
const mongoose = require('mongoose');
const ConnectorAccount = require('../models/ConnectorAccount');
const WebhookDelivery = require('../models/WebhookDelivery');
const Card = require('../models/Card');
const Member = require('../models/Member');
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
const MAX_WORKER_RESPONSE_BINDINGS = 100;
const DEFAULT_WORKER_RESPONSE_OPTION_LIMIT = 100;
const MAX_WORKER_RESPONSE_OPTION_LIMIT = 250;
const WORKER_RESPONSE_TYPES = new Set(['acknowledged', 'completed', 'blocked', 'needs_help']);
const WORKER_RESPONSE_SOURCES = new Set(['slack', 'teams', 'google_chat', 'discord', 'mattermost', 'webex', 'email']);

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

const isGenericWebhookPath = (path) => /^\/api\/webhooks\/generic\/[a-f\d]{24}(?:\/worker-response)?$/i.test(String(path || '').split('?')[0]);

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

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class GenericWebhookService {
  constructor(dependencies = {}) {
    this.ConnectorAccount = dependencies.ConnectorAccount || ConnectorAccount;
    this.WebhookDelivery = dependencies.WebhookDelivery || WebhookDelivery;
    this.Card = dependencies.Card || Card;
    this.Member = dependencies.Member || Member;
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

  normalizeWorkerResponseBindings(bindings) {
    if (!Array.isArray(bindings) || bindings.length > MAX_WORKER_RESPONSE_BINDINGS) {
      throw webhookError(`workerResponseBindings must contain between 0 and ${MAX_WORKER_RESPONSE_BINDINGS} bindings`, 400, 'invalid_payload');
    }

    const seen = new Set();
    return bindings.map((binding) => {
      if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
        throw webhookError('Each worker response binding must be an object', 400, 'invalid_payload');
      }
      const source = String(binding.source || '').trim();
      const sourceMemberId = String(binding.sourceMemberId || '').trim();
      const sourceCardId = String(binding.sourceCardId || '').trim();
      const memberId = String(binding.memberId || '').trim();
      const cardId = String(binding.cardId || '').trim();
      if (!WORKER_RESPONSE_SOURCES.has(source) || !ID_PATTERN.test(sourceMemberId) || !ID_PATTERN.test(sourceCardId) || !mongoose.isValidObjectId(memberId) || !mongoose.isValidObjectId(cardId)) {
        throw webhookError('A worker response binding is invalid', 400, 'invalid_payload');
      }
      const key = `${source}:${sourceMemberId}:${sourceCardId}`;
      if (seen.has(key)) {
        throw webhookError('Worker response bindings must not duplicate a source worker and card pair', 400, 'invalid_payload');
      }
      seen.add(key);
      return { source, sourceMemberId, sourceCardId, memberId, cardId };
    });
  }

  async configureWorkerResponseBindings({ accountId, bindings, workspaceId, actor }) {
    if (!mongoose.isValidObjectId(accountId)) {
      throw webhookError('Connector account was not found', 404, 'not_configured');
    }
    const account = await this.ConnectorAccount.findOne({
      _id: accountId,
      workspaceId,
      connectorId: 'webhook_generic',
      status: 'connected'
    });
    if (!account) throw webhookError('A connected Generic Webhook account is required', 404, 'not_configured');

    const normalized = this.normalizeWorkerResponseBindings(bindings);
    const memberIds = [...new Set(normalized.map(binding => binding.memberId))];
    const cardIds = [...new Set(normalized.map(binding => binding.cardId))];
    const [members, cards] = await Promise.all([
      this.Member.find({ workspaceId, _id: { $in: memberIds } }),
      this.Card.find({ workspaceId, _id: { $in: cardIds } })
    ]);
    const memberIdSet = new Set(members.map(member => String(member._id)));
    const cardsById = new Map(cards.map(card => [String(card._id), card]));
    for (const binding of normalized) {
      const card = cardsById.get(binding.cardId);
      if (!memberIdSet.has(binding.memberId) || !card || !(card.members || []).some(memberId => String(memberId) === binding.memberId)) {
        throw webhookError('Each worker response binding must reference a workspace member assigned to the mapped card', 400, 'invalid_payload');
      }
    }

    const beforeCount = Array.isArray(account.metadata?.workerResponseBindings)
      ? account.metadata.workerResponseBindings.length
      : 0;
    const previousMetadata = account.metadata;
    account.metadata = { ...(account.metadata || {}), workerResponseBindings: normalized };
    await account.save();
    try {
      await this.operationsLedgerService.recordAudit({
        workspaceId: account.workspaceId,
        entityType: 'connector_account',
        entityId: account._id,
        action: 'generic_webhook_worker_response_bindings_configured',
        actor: actor || 'local-user',
        source: 'api',
        riskLevel: 'medium',
        beforeState: { connectorId: account.connectorId, bindingCount: beforeCount },
        afterState: { connectorId: account.connectorId, bindingCount: normalized.length }
      });
    } catch (error) {
      account.metadata = previousMetadata;
      await account.save();
      throw webhookError('Worker response bindings were not saved because audit evidence could not be recorded', 503, 'audit_unavailable');
    }
    return normalized;
  }

  async getWorkerResponseBindings({ accountId, workspaceId }) {
    if (!mongoose.isValidObjectId(accountId)) {
      throw webhookError('Connector account was not found', 404, 'not_configured');
    }
    const account = await this.ConnectorAccount.findOne({
      _id: accountId,
      workspaceId,
      connectorId: 'webhook_generic'
    });
    if (!account) throw webhookError('Connector account was not found', 404, 'not_configured');
    return this.normalizeWorkerResponseBindings(account.metadata?.workerResponseBindings || []);
  }

  async getWorkerResponseBindingOptions({ accountId, workspaceId, memberId, query, limit }) {
    if (!mongoose.isValidObjectId(accountId)) {
      throw webhookError('Connector account was not found', 404, 'not_configured');
    }
    if (memberId && !mongoose.isValidObjectId(memberId)) {
      throw webhookError('Workspace member was not found', 400, 'invalid_payload');
    }

    const account = await this.ConnectorAccount.findOne({
      _id: accountId,
      workspaceId,
      connectorId: 'webhook_generic',
      status: 'connected'
    });
    if (!account) throw webhookError('A connected Generic Webhook account is required', 404, 'not_configured');

    const optionLimit = boundedInteger(limit, DEFAULT_WORKER_RESPONSE_OPTION_LIMIT, 1, MAX_WORKER_RESPONSE_OPTION_LIMIT);
    const search = String(query || '').trim().slice(0, 80);
    const match = search ? new RegExp(escapeRegExp(search), 'i') : null;
    const memberFilter = { workspaceId };
    if (match) memberFilter.$or = [{ fullName: match }, { username: match }];

    const members = await this.Member.find(memberFilter)
      .select('_id fullName username')
      .sort({ fullName: 1, username: 1 })
      .limit(optionLimit);
    const cards = memberId
      ? await this.Card.find({ workspaceId, members: memberId })
        .select('_id name closed lastActivity')
        .sort({ closed: 1, lastActivity: -1 })
        .limit(optionLimit)
      : [];

    return {
      members: members.map((member) => ({
        id: String(member._id),
        name: String(member.fullName || member.username || member._id),
        username: String(member.username || '')
      })),
      cards: cards.map((card) => ({
        id: String(card._id),
        name: String(card.name || card._id),
        closed: Boolean(card.closed)
      }))
    };
  }

  normalizeWorkerResponseEvent(payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw webhookError('Webhook payload must be an object', 400, 'invalid_payload');
    }
    const id = String(payload.id || '').trim();
    const source = String(payload.source || '').trim();
    const sourceMemberId = String(payload.sourceMemberId || '').trim();
    const sourceCardId = String(payload.sourceCardId || '').trim();
    const responseType = String(payload.responseType || '').trim();
    const responseText = typeof payload.responseText === 'string' ? payload.responseText.trim().slice(0, 2000) : '';
    if (!ID_PATTERN.test(id) || !WORKER_RESPONSE_SOURCES.has(source) || !ID_PATTERN.test(sourceMemberId) || !ID_PATTERN.test(sourceCardId) || !WORKER_RESPONSE_TYPES.has(responseType) || !responseText) {
      throw webhookError('Webhook worker response payload is invalid', 400, 'invalid_payload');
    }
    return { id, source, sourceMemberId, sourceCardId, responseType, responseText };
  }

  findWorkerResponseBinding(account, event) {
    const bindings = this.normalizeWorkerResponseBindings(account.metadata?.workerResponseBindings || []);
    return bindings.find(binding =>
      binding.source === event.source && binding.sourceMemberId === event.sourceMemberId && binding.sourceCardId === event.sourceCardId
    ) || null;
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

  async finalizeDelivery(delivery, status, artifacts = {}) {
    if (!delivery?._id) return;
    const update = {
      status,
      leaseExpiresAt: undefined,
      processedAt: new Date()
    };
    if (artifacts.signalId) update.signalId = artifacts.signalId;
    if (artifacts.workerResponseId) update.workerResponseId = artifacts.workerResponseId;
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

    await this.finalizeDelivery(claimed.delivery, 'succeeded', { signalId: signal.id });

    return normalizedDeliveryId
      ? { event, signal, duplicate: false, processing: false }
      : { event, signal };
  }

  async ingestWorkerResponse({ accountId, rawBody, body, signature, deliveryId }) {
    if (!mongoose.isValidObjectId(accountId)) {
      throw webhookError('Webhook endpoint is not configured', 404, 'not_configured');
    }
    const account = await this.ConnectorAccount.findOne({
      _id: accountId,
      connectorId: 'webhook_generic',
      status: 'connected'
    });
    if (!account) throw webhookError('Webhook endpoint is not configured', 404, 'not_configured');

    const credentials = this.accountConnectorService.getAccountCredentials(account);
    this.verifySignature(rawBody, signature, credentials.signingSecret);
    const event = this.normalizeWorkerResponseEvent(Buffer.isBuffer(body) ? this.parsePayload(rawBody) : body);
    const binding = this.findWorkerResponseBinding(account, event);
    if (!binding) throw webhookError('Webhook worker response is not configured', 403, 'not_configured');
    const normalizedDeliveryId = this.normalizeDeliveryId(deliveryId || event.id);
    const claimed = await this.claimDelivery(account, normalizedDeliveryId);
    if (!claimed.acquired) {
      return {
        event: { id: event.id },
        workerResponse: { id: claimed.delivery.workerResponseId || null },
        duplicate: true,
        processing: claimed.delivery.status === 'processing'
      };
    }

    let result;
    try {
      result = await this.operationsLedgerService.recordChatWorkerResponse({
        workspaceId: account.workspaceId,
        memberId: binding.memberId,
        cardId: binding.cardId,
        responseType: event.responseType,
        responseText: event.responseText,
        source: binding.source,
        actor: `connector:${String(account._id)}`
      });
      await this.operationsLedgerService.recordAudit({
        workspaceId: account.workspaceId,
        entityType: 'connector_webhook',
        entityId: account._id,
        action: result.recorded ? 'generic_webhook_worker_response_recorded' : 'generic_webhook_worker_response_unmatched',
        actor: `connector:${String(account._id)}`,
        source: 'system',
        riskLevel: 'low',
        afterState: {
          connectorId: 'webhook_generic',
          connectorAccountId: String(account._id),
          eventId: event.id,
          source: binding.source,
          responseType: event.responseType,
          recorded: Boolean(result.recorded),
          reason: result.reason || undefined,
          interventionId: result.interventionId ? String(result.interventionId) : undefined,
          workerResponseId: result.response?.id ? String(result.response.id) : undefined
        }
      });
    } catch (error) {
      await this.finalizeDelivery(claimed.delivery, 'failed');
      throw error;
    }

    const workerResponseId = result.response?.id || result.response?._id;
    await this.finalizeDelivery(claimed.delivery, 'succeeded', { workerResponseId });
    return {
      event: { id: event.id },
      workerResponse: result.recorded ? { id: String(workerResponseId), recorded: true } : { id: null, recorded: false, reason: result.reason },
      duplicate: false,
      processing: false
    };
  }
}

module.exports = new GenericWebhookService();
module.exports.GenericWebhookService = GenericWebhookService;
module.exports.getMaxBodyBytes = getMaxBodyBytes;
module.exports.isGenericWebhookPath = isGenericWebhookPath;
