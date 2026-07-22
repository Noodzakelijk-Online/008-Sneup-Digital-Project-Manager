const mongoose = require('mongoose');

const sourceEvidenceSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['board', 'card', 'comment', 'member', 'analytics', 'intervention', 'manual', 'system', 'work_item', 'work_graph'],
    default: 'system'
  },
  entityId: mongoose.Schema.Types.Mixed,
  label: String,
  url: String,
  observedAt: Date,
  data: mongoose.Schema.Types.Mixed
}, { _id: false });

const recommendationSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    index: true
  },
  boardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    index: true
  },
  cardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Card',
    index: true
  },
  memberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',
    index: true
  },
  interventionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Intervention',
    index: true
  },
  findingType: {
    type: String,
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true
  },
  description: String,
  recommendedAction: {
    type: String,
    required: true
  },
  actionType: {
    type: String,
    required: true,
    index: true
  },
  actionPayload: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  riskLevel: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
    index: true
  },
  confidence: {
    type: Number,
    min: 0,
    max: 1,
    default: 0.7
  },
  requiresApproval: {
    type: Boolean,
    default: true,
    index: true
  },
  approvalReason: String,
  ownerType: {
    type: String,
    enum: ['robert', 'va', 'team', 'system'],
    default: 'robert',
    index: true
  },
  sourceEvidence: [sourceEvidenceSchema],
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'change_requested', 'snoozed', 'delegated', 'executing', 'executed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  approvedAt: Date,
  approvalExpiresAt: {
    type: Date,
    index: true
  },
  approvalExpiredAt: Date,
  approvalExpiryReason: String,
  rejectedAt: Date,
  executedAt: Date,
  failureReason: String
}, {
  timestamps: true
});

recommendationSchema.index({ status: 1, riskLevel: -1, createdAt: 1 });
recommendationSchema.index({ boardId: 1, status: 1, createdAt: -1 });
recommendationSchema.index({ cardId: 1, createdAt: -1 });
recommendationSchema.index({ workspaceId: 1, status: 1, riskLevel: -1, createdAt: -1 });
recommendationSchema.index({ workspaceId: 1, boardId: 1, status: 1, createdAt: -1 });
recommendationSchema.index({ workspaceId: 1, status: 1, approvalExpiresAt: 1 });

module.exports = mongoose.model('Recommendation', recommendationSchema);
