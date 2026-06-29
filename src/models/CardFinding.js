const mongoose = require('mongoose');

const sourceEvidenceSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['board', 'card', 'comment', 'member', 'list', 'analytics', 'system'],
    default: 'system'
  },
  entityId: mongoose.Schema.Types.Mixed,
  label: String,
  url: String,
  observedAt: Date,
  data: mongoose.Schema.Types.Mixed
}, { _id: false });

const cardFindingSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    index: true
  },
  boardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    required: true,
    index: true
  },
  cardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Card',
    required: true,
    index: true
  },
  memberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',
    index: true
  },
  findingType: {
    type: String,
    required: true,
    enum: ['overdue', 'stale', 'missing_next_action', 'unassigned', 'blocked', 'stuck', 'robert_required', 'va_ready', 'external_waiting'],
    index: true
  },
  title: {
    type: String,
    required: true
  },
  description: String,
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
    index: true
  },
  status: {
    type: String,
    enum: ['open', 'resolved', 'ignored', 'superseded'],
    default: 'open',
    index: true
  },
  waitingOn: {
    type: String,
    enum: ['robert', 'va', 'team', 'worker', 'external', 'unknown'],
    default: 'unknown',
    index: true
  },
  signalScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 50
  },
  recommendedAction: String,
  sourceEvidence: [sourceEvidenceSchema],
  firstDetectedAt: {
    type: Date,
    default: Date.now
  },
  lastObservedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  resolvedAt: Date
}, {
  timestamps: true
});

cardFindingSchema.index({ boardId: 1, status: 1, severity: -1, lastObservedAt: -1 });
cardFindingSchema.index({ cardId: 1, status: 1, findingType: 1 });
cardFindingSchema.index({ findingType: 1, status: 1, createdAt: -1 });
cardFindingSchema.index({ workspaceId: 1, boardId: 1, status: 1, severity: -1, lastObservedAt: -1 });
cardFindingSchema.index({ workspaceId: 1, cardId: 1, status: 1, findingType: 1 });

module.exports = mongoose.model('CardFinding', cardFindingSchema);