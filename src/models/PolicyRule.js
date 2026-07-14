const mongoose = require('mongoose');

const policyRuleSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  actionType: {
    type: String,
    required: true,
    index: true
  },
  riskLevel: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  requiresApproval: {
    type: Boolean,
    default: true
  },
  ownerType: {
    type: String,
    enum: ['robert', 'va', 'team', 'system'],
    default: 'robert'
  },
  enabled: {
    type: Boolean,
    default: true,
    index: true
  },
  pauseExpiresAt: {
    type: Date,
    default: null
  },
  conditions: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  reason: String,
  updatedBy: {
    type: String,
    default: 'system'
  }
}, {
  timestamps: true
});

policyRuleSchema.index({ workspaceId: 1, actionType: 1 }, { unique: true });
policyRuleSchema.index({ workspaceId: 1, enabled: 1, updatedAt: -1 });

module.exports = mongoose.model('PolicyRule', policyRuleSchema);
