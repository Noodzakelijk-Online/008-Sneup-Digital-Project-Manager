const crypto = require('crypto');
const net = require('net');
const mongoose = require('mongoose');
const axios = require('axios');
const NotificationPolicy = require('../models/NotificationPolicy');
const NotificationDelivery = require('../models/NotificationDelivery');
const AuditEvent = require('../models/AuditEvent');
const accountConnectorService = require('./accountConnectorService');
const operationsLedgerService = require('./operationsLedgerService');
const { normalizeWorkspaceObjectId } = require('./workspaceScopeService');
const { safeExternalSourceUrl } = require('../utils/externalSourceUrl');
const logger = require('../utils/logger');

const MAX_POLICY_LIMIT = 100;
const MAX_DELIVERY_LIMIT = 250;
const MAX_DIGEST_ITEMS = 25;
const EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const severityRank = { warning: 1, critical: 2 };

const compact = (value, maximum = 4000) => String(value || '').trim().slice(0, maximum);

const isPrivateIpv4 = (hostname) => {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
};

class NotificationService {
  constructor(options = {}) {
    this.http = options.http || axios;
  }

  isDatabaseReady() {
    return mongoose.connection.readyState === 1;
  }

  requireDatabase() {
    if (!this.isDatabaseReady()) {
      const error = new Error('Database connection is required for notification delivery');
      error.statusCode = 503;
      throw error;
    }
  }

  resolveWorkspaceId(workspaceId) {
    return normalizeWorkspaceObjectId(workspaceId);
  }

  assertSafeWebhookUrl(rawUrl) {
    let url;
    try {
      url = new URL(String(rawUrl || '').trim());
    } catch (error) {
      const invalid = new Error('A valid HTTPS webhook URL is required');
      invalid.statusCode = 400;
      throw invalid;
    }

    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hostname
      || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
      || net.isIP(hostname) === 6 || isPrivateIpv4(hostname)) {
      const invalid = new Error('Webhook destination must be a public HTTPS URL without credentials or a custom port');
      invalid.statusCode = 400;
      throw invalid;
    }

    return url.toString();
  }

  assertSafeEmailAddress(rawEmail) {
    const email = compact(rawEmail, 254);
    if (!EMAIL_PATTERN.test(email) || /[\r\n]/.test(email)) {
      const invalid = new Error('A valid single email recipient is required');
      invalid.statusCode = 400;
      throw invalid;
    }
    return email;
  }

  destinationForChannel(channel, body = {}) {
    if (channel === 'email') return body.destinationEmail ?? body.destination;
    return body.destinationUrl ?? body.destination;
  }

  validateDestination(channel, destination) {
    return channel === 'email'
      ? this.assertSafeEmailAddress(destination)
      : this.assertSafeWebhookUrl(destination);
  }

  normalizeEventTypes(value) {
    const eventTypes = Array.isArray(value) ? value : [value || 'reconciliation_alert'];
    const unique = [...new Set(eventTypes.map(item => String(item || '').trim()).filter(Boolean))];
    if (unique.length === 0 || unique.some(item => item !== 'reconciliation_alert')) {
      const error = new Error('Only reconciliation_alert notification events are currently supported');
      error.statusCode = 400;
      throw error;
    }
    return unique;
  }

  normalizePolicyInput(body = {}) {
    const name = compact(body.name, 120);
    const channel = compact(body.channel, 40);
    const destinationLabel = compact(body.destinationLabel, 160);
    const minimumSeverity = compact(body.minimumSeverity || 'warning', 20);
    const status = compact(body.status || 'paused', 20);
    if (name.length < 3) {
      const error = new Error('Notification policy name must be at least 3 characters');
      error.statusCode = 400;
      throw error;
    }
    if (!['slack_webhook', 'teams_webhook', 'generic_webhook', 'email'].includes(channel)) {
      const error = new Error('Notification channel must be slack_webhook, teams_webhook, generic_webhook, or email');
      error.statusCode = 400;
      throw error;
    }
    if (!['warning', 'critical'].includes(minimumSeverity)) {
      const error = new Error('minimumSeverity must be warning or critical');
      error.statusCode = 400;
      throw error;
    }
    if (!['active', 'paused'].includes(status)) {
      const error = new Error('Notification policy status must be active or paused');
      error.statusCode = 400;
      throw error;
    }
    const quietHours = body.quietHours || {};
    const startHourUtc = Number(quietHours.startHourUtc ?? 18);
    const endHourUtc = Number(quietHours.endHourUtc ?? 8);
    if (!Number.isInteger(startHourUtc) || !Number.isInteger(endHourUtc)
      || startHourUtc < 0 || startHourUtc > 23 || endHourUtc < 0 || endHourUtc > 23
      || (quietHours.enabled === true && startHourUtc === endHourUtc)) {
      const error = new Error('Quiet hours must use distinct UTC hours from 0 through 23');
      error.statusCode = 400;
      throw error;
    }
    const digest = body.digest || {};
    const digestHourUtc = Number(digest.hourUtc ?? 9);
    const digestMaximumItems = Number(digest.maximumItems ?? 10);
    if (!Number.isInteger(digestHourUtc) || digestHourUtc < 0 || digestHourUtc > 23
      || !Number.isInteger(digestMaximumItems) || digestMaximumItems < 1 || digestMaximumItems > MAX_DIGEST_ITEMS) {
      const error = new Error(`Digest settings require a UTC hour from 0 through 23 and 1 through ${MAX_DIGEST_ITEMS} items`);
      error.statusCode = 400;
      throw error;
    }
    return {
      name,
      channel,
      destinationLabel,
      minimumSeverity,
      status,
      eventTypes: this.normalizeEventTypes(body.eventTypes),
      quietHours: { enabled: quietHours.enabled === true, startHourUtc, endHourUtc },
      digest: { enabled: digest.enabled === true, hourUtc: digestHourUtc, maximumItems: digestMaximumItems }
    };
  }

  sanitizePolicy(policy) {
    if (!policy) return null;
    return {
      id: String(policy._id),
      workspaceId: String(policy.workspaceId),
      name: policy.name,
      channel: policy.channel,
      destinationLabel: policy.destinationLabel || '',
      destinationConfigured: Boolean(policy.destinationEncrypted),
      eventTypes: policy.eventTypes || [],
      minimumSeverity: policy.minimumSeverity,
      quietHours: policy.quietHours || { enabled: false, startHourUtc: 18, endHourUtc: 8 },
      digest: policy.digest || { enabled: false, hourUtc: 9, maximumItems: 10 },
      status: policy.status,
      activatedBy: policy.activatedBy || '',
      activatedAt: policy.activatedAt,
      createdBy: policy.createdBy || '',
      updatedBy: policy.updatedBy || '',
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt
    };
  }

  sanitizeDelivery(delivery) {
    if (!delivery) return null;
    return {
      id: String(delivery._id),
      workspaceId: String(delivery.workspaceId),
      policyId: String(delivery.policyId),
      eventType: delivery.eventType,
      severity: delivery.severity,
      title: delivery.title,
      message: delivery.message,
      sourceType: delivery.sourceType || '',
      sourceId: delivery.sourceId || '',
      sourceUrl: safeExternalSourceUrl(delivery.sourceUrl) || '',
      sourceEvidence: (delivery.sourceEvidence || []).map((item = {}) => ({
        sourceType: compact(item.sourceType, 80),
        sourceId: compact(item.sourceId, 160),
        label: compact(item.label, 240),
        url: safeExternalSourceUrl(item.url)
      })).filter(item => item.url),
      status: delivery.status,
      claimedAt: delivery.claimedAt,
      deliveredAt: delivery.deliveredAt,
      failedAt: delivery.failedAt,
      responseStatus: delivery.responseStatus,
      errorMessage: delivery.errorMessage || '',
      attemptCount: delivery.attemptCount || 0,
      deferredUntil: delivery.deferredUntil,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt
    };
  }

  async listPolicies(options = {}) {
    this.requireDatabase();
    const policies = await NotificationPolicy.find({ workspaceId: this.resolveWorkspaceId(options.workspaceId) })
      .select('+destinationEncrypted')
      .sort({ status: 1, updatedAt: -1 })
      .limit(Math.min(Number(options.limit) || MAX_POLICY_LIMIT, MAX_POLICY_LIMIT));
    return policies.map(policy => this.sanitizePolicy(policy));
  }

  async listDeliveries(options = {}) {
    this.requireDatabase();
    const query = { workspaceId: this.resolveWorkspaceId(options.workspaceId) };
    if (options.status) query.status = options.status;
    if (options.policyId) query.policyId = options.policyId;
    const deliveries = await NotificationDelivery.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(options.limit) || MAX_DELIVERY_LIMIT, MAX_DELIVERY_LIMIT));
    return deliveries.map(delivery => this.sanitizeDelivery(delivery));
  }

  async createPolicy(body = {}, options = {}) {
    this.requireDatabase();
    const input = this.normalizePolicyInput(body);
    const destination = this.validateDestination(input.channel, this.destinationForChannel(input.channel, body));
    accountConnectorService.requireEncryptionKey();
    const actor = options.actor || body.createdBy || 'sneup-operator';
    const policy = await NotificationPolicy.create({
      workspaceId: this.resolveWorkspaceId(options.workspaceId),
      ...input,
      destinationEncrypted: accountConnectorService.encrypt(destination),
      activatedBy: input.status === 'active' ? actor : undefined,
      activatedAt: input.status === 'active' ? new Date() : undefined,
      createdBy: actor,
      updatedBy: actor
    });
    await this.recordAudit('notification_policy_created', policy, actor, { status: policy.status });
    return this.sanitizePolicy(policy);
  }

  async updatePolicy(policyId, body = {}, options = {}) {
    this.requireDatabase();
    const policy = await NotificationPolicy.findOne({
      _id: policyId,
      workspaceId: this.resolveWorkspaceId(options.workspaceId)
    }).select('+destinationEncrypted');
    if (!policy) {
      const error = new Error('Notification policy not found');
      error.statusCode = 404;
      throw error;
    }
    const input = this.normalizePolicyInput({
      name: body.name ?? policy.name,
      channel: body.channel ?? policy.channel,
      destinationLabel: body.destinationLabel ?? policy.destinationLabel,
      minimumSeverity: body.minimumSeverity ?? policy.minimumSeverity,
      status: body.status ?? policy.status,
      eventTypes: body.eventTypes ?? policy.eventTypes,
      quietHours: body.quietHours ?? policy.quietHours,
      digest: body.digest ?? policy.digest
    });
    const actor = options.actor || body.updatedBy || 'sneup-operator';
    const statusChangedToActive = input.status === 'active' && policy.status !== 'active';
    const channelChanged = input.channel !== policy.channel;
    Object.assign(policy, input, {
      updatedBy: actor,
      activatedBy: statusChangedToActive ? actor : policy.activatedBy,
      activatedAt: statusChangedToActive ? new Date() : policy.activatedAt
    });
    const destinationProvided = body.destinationUrl !== undefined || body.destinationEmail !== undefined || body.destination !== undefined;
    if (destinationProvided || channelChanged) {
      accountConnectorService.requireEncryptionKey();
      const destination = destinationProvided
        ? this.destinationForChannel(input.channel, body)
        : accountConnectorService.decrypt(policy.destinationEncrypted);
      policy.destinationEncrypted = accountConnectorService.encrypt(this.validateDestination(input.channel, destination));
    }
    await policy.save();
    await this.recordAudit('notification_policy_updated', policy, actor, { status: policy.status });
    return this.sanitizePolicy(policy);
  }

  async sendPolicyTest(policyId, options = {}) {
    this.requireDatabase();
    const policy = await NotificationPolicy.findOne({
      _id: policyId,
      workspaceId: this.resolveWorkspaceId(options.workspaceId)
    }).select('+destinationEncrypted');
    if (!policy) {
      const error = new Error('Notification policy not found');
      error.statusCode = 404;
      throw error;
    }
    if (options.confirmDelivery !== true) {
      const error = new Error('Set confirmDelivery to true before sending a test notification');
      error.statusCode = 400;
      throw error;
    }
    return this.createAndDeliver(policy, {
      eventType: 'test',
      dedupeKey: `test:${crypto.randomUUID()}`,
      severity: 'info',
      title: 'Sneup notification test',
      message: 'This confirms the policy can receive Sneup operational alerts.',
      sourceType: 'notification_policy',
      sourceId: String(policy._id)
    }, options.actor || 'sneup-operator');
  }

  async dispatchReconciliationAlerts(options = {}) {
    this.requireDatabase();
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const policies = await NotificationPolicy.find({
      workspaceId,
      status: 'active',
      eventTypes: 'reconciliation_alert'
    }).select('+destinationEncrypted');
    if (policies.length === 0) return { processedCount: 0, successCount: 0, failureCount: 0, metadata: { activePolicies: 0 } };

    const deferred = await this.flushDeferredDeliveries(policies, options.now);

    const health = await operationsLedgerService.getTrelloActionReconciliationHealth({ workspaceId, limit: 250 });
    const alerts = health.items.filter(item => item.severity === 'warning' || item.severity === 'critical');
    const dayKey = new Date(health.generatedAt).toISOString().slice(0, 10);
    let successCount = deferred.successCount;
    let failureCount = deferred.failureCount;
    let processedCount = deferred.processedCount;

    for (const policy of policies) {
      for (const alert of alerts) {
        if ((severityRank[alert.severity] || 0) < (severityRank[policy.minimumSeverity] || 0)) continue;
        processedCount += 1;
        try {
          const result = await this.createAndDeliver(policy, {
            eventType: 'reconciliation_alert',
            dedupeKey: `reconciliation:${alert.attemptId}:${alert.severity}:${dayKey}`,
            severity: alert.severity,
            title: `Sneup: ${alert.severity} reconciliation evidence gap`,
            message: `${alert.actionType || 'Trello action'} ${alert.message}`,
            sourceType: 'trello_action_attempt',
            sourceId: alert.attemptId,
            sourceUrl: safeExternalSourceUrl(alert.sourceUrl),
            now: options.now
          }, 'sneup-notification-worker');
          if (['delivered', 'duplicate', 'deferred', 'digest_pending'].includes(result.status)) successCount += 1;
          else failureCount += 1;
        } catch (error) {
          failureCount += 1;
          logger.error('Notification dispatch failed:', error);
        }
      }
    }

    const digests = await this.flushDueDigests(policies, options.now);
    processedCount += digests.processedCount;
    successCount += digests.successCount;
    failureCount += digests.failureCount;

    return {
      processedCount,
      successCount,
      failureCount,
      metadata: {
        activePolicies: policies.length,
        reconciliationAlerts: alerts.length,
        digests: digests.digestCount,
        warningHours: health.thresholds.warningHours,
        criticalHours: health.thresholds.criticalHours
      }
    };
  }

  async dispatchAllReconciliationAlerts() {
    this.requireDatabase();
    const workspaceIds = await NotificationPolicy.distinct('workspaceId', {
      status: 'active',
      eventTypes: 'reconciliation_alert'
    });
    const totals = { processedCount: 0, successCount: 0, failureCount: 0, workspaces: workspaceIds.length };
    for (const workspaceId of workspaceIds) {
      const result = await this.dispatchReconciliationAlerts({ workspaceId });
      totals.processedCount += result.processedCount;
      totals.successCount += result.successCount;
      totals.failureCount += result.failureCount;
    }
    return { ...totals, metadata: { workspaces: totals.workspaces } };
  }

  async createAndDeliver(policy, event, actor) {
    const workspaceId = this.resolveWorkspaceId(policy.workspaceId);
    let delivery;
    try {
      delivery = await NotificationDelivery.create({
        workspaceId,
        policyId: policy._id,
        ...event,
        status: 'queued'
      });
    } catch (error) {
      if (error?.code === 11000) {
        return { status: 'duplicate' };
      }
      throw error;
    }

    if (event.eventType === 'reconciliation_alert' && event.severity === 'warning' && policy.digest?.enabled) {
      delivery.status = 'digest_pending';
      await delivery.save();
      await this.recordAudit('notification_digest_pending', delivery, actor, { status: delivery.status });
      return { status: 'digest_pending', delivery: this.sanitizeDelivery(delivery) };
    }

    if (event.severity !== 'critical' && this.isQuietHours(policy, event.now)) {
      delivery.status = 'deferred';
      delivery.deferredUntil = this.nextQuietHoursEnd(policy, event.now);
      await delivery.save();
      await this.recordAudit('notification_deferred', delivery, actor, { status: delivery.status, deferredUntil: delivery.deferredUntil });
      return { status: 'deferred', delivery: this.sanitizeDelivery(delivery) };
    }

    return this.deliverExisting(policy, delivery, event, actor);
  }

  digestDedupeKey(now = new Date()) {
    return `reconciliation-digest:${new Date(now).toISOString().slice(0, 10)}`;
  }

  isDigestDue(policy, now = new Date()) {
    return Boolean(policy.digest?.enabled) && new Date(now).getUTCHours() >= policy.digest.hourUtc;
  }

  buildDigestEvent(deliveries, pendingCount, now = new Date()) {
    const sourceEvidence = deliveries.map((delivery) => ({
      sourceType: delivery.sourceType || 'trello_action_attempt',
      sourceId: delivery.sourceId || String(delivery._id),
      label: compact(delivery.title, 240),
      url: safeExternalSourceUrl(delivery.sourceUrl)
    })).filter(item => item.url);
    const shownCount = deliveries.length;
    const omittedCount = Math.max(0, pendingCount - shownCount);
    const message = [
      `${pendingCount} warning reconciliation evidence gap${pendingCount === 1 ? '' : 's'} need operator review.`,
      ...deliveries.map(item => `- ${compact(item.message, 500)}`),
      omittedCount > 0 ? `- ${omittedCount} additional gap${omittedCount === 1 ? '' : 's'} remain in the Sneup ledger.` : ''
    ].filter(Boolean).join('\n');
    return {
      eventType: 'reconciliation_digest',
      dedupeKey: this.digestDedupeKey(now),
      severity: 'warning',
      title: `Sneup: ${pendingCount} reconciliation evidence gap${pendingCount === 1 ? '' : 's'} need review`,
      message,
      sourceType: 'trello_action_attempt',
      sourceEvidence,
      digestSourceDeliveryIds: deliveries.map(item => item._id),
      now
    };
  }

  async flushDueDigests(policies, now = new Date()) {
    const totals = { processedCount: 0, successCount: 0, failureCount: 0, digestCount: 0 };
    for (const policy of policies) {
      if (!this.isDigestDue(policy, now)) continue;

      const dedupeKey = this.digestDedupeKey(now);
      const existing = await NotificationDelivery.exists({
        workspaceId: policy.workspaceId,
        policyId: policy._id,
        dedupeKey
      });
      if (existing) continue;

      const pendingQuery = {
        workspaceId: policy.workspaceId,
        policyId: policy._id,
        eventType: 'reconciliation_alert',
        status: 'digest_pending'
      };
      const maximumItems = Math.min(policy.digest.maximumItems || 10, MAX_DIGEST_ITEMS);
      const [pendingCount, deliveries] = await Promise.all([
        NotificationDelivery.countDocuments(pendingQuery),
        NotificationDelivery.find(pendingQuery).sort({ createdAt: 1 }).limit(maximumItems)
      ]);
      if (pendingCount === 0 || deliveries.length === 0) continue;

      totals.processedCount += deliveries.length;
      totals.digestCount += 1;
      try {
        const result = await this.createAndDeliver(policy, this.buildDigestEvent(deliveries, pendingCount, now), 'sneup-notification-worker');
        if (['delivered', 'deferred', 'duplicate'].includes(result.status)) totals.successCount += 1;
        else totals.failureCount += 1;
      } catch (error) {
        totals.failureCount += 1;
        logger.error('Notification digest delivery failed:', error);
      }
    }
    return totals;
  }

  isQuietHours(policy, now = new Date()) {
    const quietHours = policy.quietHours;
    if (!quietHours?.enabled) return false;
    const hour = new Date(now).getUTCHours();
    const start = quietHours.startHourUtc;
    const end = quietHours.endHourUtc;
    return start > end ? hour >= start || hour < end : hour >= start && hour < end;
  }

  nextQuietHoursEnd(policy, now = new Date()) {
    const value = new Date(now);
    value.setUTCMinutes(0, 0, 0);
    const { startHourUtc, endHourUtc } = policy.quietHours;
    value.setUTCHours(endHourUtc);
    if (startHourUtc > endHourUtc && new Date(now).getUTCHours() >= startHourUtc) value.setUTCDate(value.getUTCDate() + 1);
    return value;
  }

  async flushDeferredDeliveries(policies, now = new Date()) {
    const totals = { processedCount: 0, successCount: 0, failureCount: 0 };
    for (const policy of policies) {
      if (this.isQuietHours(policy, now)) continue;
      const deliveries = await NotificationDelivery.find({
        workspaceId: policy.workspaceId,
        policyId: policy._id,
        status: 'deferred',
        deferredUntil: { $lte: new Date(now) }
      }).sort({ deferredUntil: 1 }).limit(100);
      for (const delivery of deliveries) {
        totals.processedCount += 1;
        try {
          await this.deliverExisting(policy, delivery, delivery, 'sneup-notification-worker');
          totals.successCount += 1;
        } catch (error) {
          totals.failureCount += 1;
        }
      }
    }
    return totals;
  }

  async deliverExisting(policy, delivery, event, actor) {
    delivery.status = 'sending';
    delivery.claimedAt = new Date();
    delivery.attemptCount = 1;
    await delivery.save();

    try {
      const response = await this.postWebhook(policy, event);
      delivery.status = 'delivered';
      delivery.deliveredAt = new Date();
      delivery.responseStatus = response.status;
      await delivery.save();
      if (delivery.eventType === 'reconciliation_digest') await this.markDigestSourcesDelivered(delivery);
      await this.recordAudit('notification_delivered', delivery, actor, { status: delivery.status, responseStatus: response.status });
      return { status: 'delivered', delivery: this.sanitizeDelivery(delivery) };
    } catch (error) {
      delivery.status = 'failed';
      delivery.failedAt = new Date();
      delivery.errorMessage = this.sanitizeDeliveryError(error);
      await delivery.save();
      await this.recordAudit('notification_delivery_failed', delivery, actor, { status: delivery.status, errorMessage: delivery.errorMessage });
      throw error;
    }
  }

  async postWebhook(policy, event) {
    if (policy.channel === 'email') return this.postEmail(policy, event);
    const destination = this.assertSafeWebhookUrl(accountConnectorService.decrypt(policy.destinationEncrypted));
    return this.http.post(destination, this.buildWebhookPayload(policy.channel, event), {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Sneup-Notification/2.0' },
      timeout: Number(process.env.SNEUP_NOTIFICATION_TIMEOUT_MS || 10000),
      maxRedirects: 0,
      proxy: false,
      validateStatus: status => status >= 200 && status < 300
    });
  }

  emailConfiguration() {
    const apiKey = compact(process.env.RESEND_API_KEY, 500);
    const from = compact(process.env.SNEUP_NOTIFICATION_EMAIL_FROM, 254);
    if (!apiKey || !from) {
      const error = new Error('Email notifications require RESEND_API_KEY and SNEUP_NOTIFICATION_EMAIL_FROM');
      error.statusCode = 503;
      throw error;
    }
    return { apiKey, from: this.assertSafeEmailAddress(from) };
  }

  async postEmail(policy, event) {
    const recipient = this.assertSafeEmailAddress(accountConnectorService.decrypt(policy.destinationEncrypted));
    const { apiKey, from } = this.emailConfiguration();
    return this.http.post('https://api.resend.com/emails', this.buildEmailPayload(event, { from, recipient }), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Sneup-Notification/2.0'
      },
      timeout: Number(process.env.SNEUP_NOTIFICATION_TIMEOUT_MS || 10000),
      maxRedirects: 0,
      proxy: false,
      validateStatus: status => status >= 200 && status < 300
    });
  }

  buildEmailPayload(event, { from, recipient }) {
    const webhookPayload = this.buildWebhookPayload('generic_webhook', event);
    const evidenceText = webhookPayload.sourceEvidence.map(item => `Source: ${item.label || 'Evidence'} ${item.url}`).join('\n');
    return {
      from,
      to: [recipient],
      subject: compact(event.title, 240) || 'Sneup operational alert',
      text: [event.message, webhookPayload.sourceUrl ? `Source: ${webhookPayload.sourceUrl}` : '', evidenceText].filter(Boolean).join('\n')
    };
  }

  buildWebhookPayload(channel, event) {
    const sourceUrl = safeExternalSourceUrl(event.sourceUrl);
    const sourceEvidence = (event.sourceEvidence || []).map((item = {}) => ({
      label: compact(item.label, 240),
      url: safeExternalSourceUrl(item.url)
    })).filter(item => item.url);
    const evidenceText = sourceEvidence.map(item => `Source: ${item.label || 'Evidence'} ${item.url}`).join('\n');
    const text = [event.title, event.message, sourceUrl ? `Source: ${sourceUrl}` : '', evidenceText].filter(Boolean).join('\n');
    if (channel === 'slack_webhook') return { text, unfurl_links: false, unfurl_media: false };
    if (channel === 'teams_webhook') return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: event.title,
      themeColor: event.severity === 'critical' ? 'C4314B' : 'D79E00',
      title: event.title,
      text: [event.message, sourceUrl ? `Source: ${sourceUrl}` : '', evidenceText].filter(Boolean).join('<br>'),
      potentialAction: sourceUrl ? [{
        '@type': 'OpenUri',
        name: 'Open source evidence',
        targets: [{ os: 'default', uri: sourceUrl }]
      }] : undefined
    };
    return {
      eventType: event.eventType,
      severity: event.severity,
      title: event.title,
      message: event.message,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      sourceUrl,
      sourceEvidence
    };
  }

  async markDigestSourcesDelivered(delivery) {
    const sourceIds = (delivery.digestSourceDeliveryIds || []).filter(Boolean);
    if (sourceIds.length === 0) return;
    await NotificationDelivery.updateMany({
      workspaceId: delivery.workspaceId,
      policyId: delivery.policyId,
      _id: { $in: sourceIds },
      status: 'digest_pending'
    }, {
      $set: { status: 'digested', digestDeliveryId: delivery._id }
    });
  }

  sanitizeDeliveryError(error) {
    if (error?.response?.status) return `Notification provider returned HTTP ${error.response.status}`;
    if (error?.code === 'ECONNABORTED') return 'Notification delivery timed out';
    return 'Notification delivery failed';
  }

  async recordAudit(action, entity, actor, afterState) {
    try {
      await AuditEvent.create({
        workspaceId: entity.workspaceId,
        entityType: entity.policyId ? 'notification_delivery' : 'notification_policy',
        entityId: entity._id,
        action,
        actor,
        source: 'system',
        riskLevel: entity.severity === 'critical' ? 'critical' : entity.severity === 'warning' ? 'high' : 'medium',
        afterState
      });
    } catch (error) {
      logger.error('Notification audit write failed:', error);
    }
  }
}

module.exports = new NotificationService();
module.exports.NotificationService = NotificationService;
