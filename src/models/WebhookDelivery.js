const mongoose = require('mongoose');

const webhookDeliverySchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  connectorAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ConnectorAccount',
    required: true,
    index: true
  },
  deliveryId: {
    type: String,
    required: true,
    maxlength: 160
  },
  status: {
    type: String,
    enum: ['processing', 'succeeded', 'failed'],
    default: 'processing',
    index: true
  },
  signalId: {
    type: String,
    maxlength: 160
  },
  attemptCount: {
    type: Number,
    default: 0
  },
  leaseExpiresAt: Date,
  processedAt: Date,
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 }
  }
}, {
  timestamps: true
});

webhookDeliverySchema.index({ connectorAccountId: 1, deliveryId: 1 }, { unique: true });
webhookDeliverySchema.index({ workspaceId: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('WebhookDelivery', webhookDeliverySchema);
