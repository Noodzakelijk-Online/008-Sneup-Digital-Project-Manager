const mongoose = require('mongoose');

const decisionQueueItemSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    index: true
  },
  recommendationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Recommendation',
    index: true
  },
  ownerType: {
    type: String,
    enum: ['robert', 'va', 'team', 'system'],
    default: 'robert',
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
  title: {
    type: String,
    required: true
  },
  question: {
    type: String,
    required: true
  },
  recommendedAnswer: {
    type: String,
    enum: ['yes', 'no', 'change', 'review', 'snooze', 'delegate'],
    default: 'yes'
  },
  options: [{ type: String }],
  riskLevel: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
    index: true
  },
  reason: String,
  sourceEvidence: [{ type: mongoose.Schema.Types.Mixed }],
  status: {
    type: String,
    enum: ['open', 'approved', 'rejected', 'change_requested', 'resolved', 'cancelled', 'snoozed', 'delegated'],
    default: 'open',
    index: true
  },
  dueAt: Date,
  snoozedUntil: Date,
  delegatedTo: String,
  delegatedBy: String,
  delegatedAt: Date,
  resolvedAt: Date,
  resolvedBy: String,
  resolutionNote: String
}, {
  timestamps: true
});

decisionQueueItemSchema.index({ ownerType: 1, status: 1, riskLevel: -1, createdAt: 1 });
decisionQueueItemSchema.index({ boardId: 1, status: 1, createdAt: -1 });
decisionQueueItemSchema.index({ status: 1, snoozedUntil: 1 });
decisionQueueItemSchema.index({ workspaceId: 1, ownerType: 1, status: 1, riskLevel: -1, createdAt: 1 });
decisionQueueItemSchema.index({ workspaceId: 1, boardId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('DecisionQueueItem', decisionQueueItemSchema);