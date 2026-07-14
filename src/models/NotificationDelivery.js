const mongoose = require('mongoose');

const notificationDeliverySchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  policyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'NotificationPolicy',
    required: true,
    index: true
  },
  eventType: {
    type: String,
    enum: ['reconciliation_alert', 'test'],
    required: true,
    index: true
  },
  dedupeKey: {
    type: String,
    required: true,
    maxlength: 300
  },
  severity: {
    type: String,
    enum: ['warning', 'critical', 'info'],
    required: true
  },
  title: {
    type: String,
    required: true,
    maxlength: 240
  },
  message: {
    type: String,
    required: true,
    maxlength: 4000
  },
  sourceType: String,
  sourceId: String,
  sourceUrl: String,
  status: {
    type: String,
    enum: ['queued', 'deferred', 'sending', 'delivered', 'failed', 'suppressed'],
    default: 'queued',
    index: true
  },
  claimedAt: Date,
  deferredUntil: Date,
  deliveredAt: Date,
  failedAt: Date,
  responseStatus: Number,
  errorMessage: String,
  attemptCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

notificationDeliverySchema.index({ workspaceId: 1, policyId: 1, dedupeKey: 1 }, { unique: true });
notificationDeliverySchema.index({ workspaceId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('NotificationDelivery', notificationDeliverySchema);
