const mongoose = require('mongoose');

const auditEventSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    index: true
  },
  entityType: {
    type: String,
    required: true,
    index: true
  },
  entityId: {
    type: mongoose.Schema.Types.Mixed,
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
  action: {
    type: String,
    required: true,
    index: true
  },
  actor: {
    type: String,
    default: 'sneup'
  },
  source: {
    type: String,
    enum: ['system', 'api', 'worker', 'approval', 'trello', 'manual'],
    default: 'system',
    index: true
  },
  beforeState: mongoose.Schema.Types.Mixed,
  afterState: mongoose.Schema.Types.Mixed,
  riskLevel: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'low',
    index: true
  },
  approvalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Approval'
  },
  recommendationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Recommendation'
  },
  trelloActionAttemptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TrelloActionAttempt'
  }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

auditEventSchema.index({ createdAt: -1 });
auditEventSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditEventSchema.index({ boardId: 1, createdAt: -1 });
auditEventSchema.index({ cardId: 1, createdAt: -1 });
auditEventSchema.index({ workspaceId: 1, createdAt: -1 });
auditEventSchema.index({ workspaceId: 1, entityType: 1, entityId: 1, createdAt: -1 });
auditEventSchema.index({ workspaceId: 1, entityType: 1, action: 1, createdAt: -1 });

module.exports = mongoose.model('AuditEvent', auditEventSchema);
