const mongoose = require('mongoose');

const policyRuleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
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

module.exports = mongoose.model('PolicyRule', policyRuleSchema);
