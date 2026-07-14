const mongoose = require('mongoose');

const outcomeEvidenceSchema = new mongoose.Schema({
  source: {
    type: String,
    enum: ['trello_action_attempt', 'card_state', 'worker_response', 'manual'],
    required: true
  },
  observedAt: {
    type: Date,
    default: Date.now
  },
  summary: {
    type: String,
    required: true,
    maxlength: 1000
  }
}, { _id: false });

const outcomeRecordSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  recommendationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Recommendation',
    required: true,
    index: true
  },
  interventionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Intervention',
    index: true
  },
  actionAttemptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TrelloActionAttempt',
    required: true,
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
  actionType: {
    type: String,
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['confirmed_improved', 'needs_attention', 'awaiting_evidence', 'not_verified'],
    default: 'awaiting_evidence',
    index: true
  },
  summary: {
    type: String,
    required: true,
    maxlength: 1000
  },
  evidence: {
    type: [outcomeEvidenceSchema],
    default: []
  },
  evaluatedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  evaluatedBy: {
    type: String,
    default: 'sneup'
  }
}, {
  timestamps: true
});

outcomeRecordSchema.index({ workspaceId: 1, actionAttemptId: 1 }, { unique: true });
outcomeRecordSchema.index({ workspaceId: 1, status: 1, evaluatedAt: -1 });
outcomeRecordSchema.index({ workspaceId: 1, recommendationId: 1, evaluatedAt: -1 });
outcomeRecordSchema.index({ workspaceId: 1, cardId: 1, evaluatedAt: -1 });

module.exports = mongoose.models.OutcomeRecord || mongoose.model('OutcomeRecord', outcomeRecordSchema);
