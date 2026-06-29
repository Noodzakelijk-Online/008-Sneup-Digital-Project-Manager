const mongoose = require('mongoose');

const trelloActionAttemptSchema = new mongoose.Schema({
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
  interventionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Intervention',
    index: true
  },
  approvalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Approval',
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
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'succeeded', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  startedAt: Date,
  finishedAt: Date,
  trelloResponse: mongoose.Schema.Types.Mixed,
  errorMessage: String,
  retryCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

trelloActionAttemptSchema.index({ status: 1, createdAt: -1 });
trelloActionAttemptSchema.index({ boardId: 1, createdAt: -1 });
trelloActionAttemptSchema.index({ cardId: 1, createdAt: -1 });
trelloActionAttemptSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });
trelloActionAttemptSchema.index({ workspaceId: 1, boardId: 1, createdAt: -1 });

module.exports = mongoose.model('TrelloActionAttempt', trelloActionAttemptSchema);