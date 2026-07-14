const mongoose = require('mongoose');

const workerResponseSchema = new mongoose.Schema({
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
  responseText: String,
  responseType: {
    type: String,
    enum: ['acknowledged', 'completed', 'blocked', 'needs_help', 'ignored', 'other'],
    default: 'other',
    index: true
  },
  receivedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  source: {
    type: String,
    enum: ['trello_comment', 'slack', 'email', 'web_chat', 'api', 'manual', 'system'],
    default: 'api'
  }
}, {
  timestamps: true
});

workerResponseSchema.index({ memberId: 1, receivedAt: -1 });
workerResponseSchema.index({ cardId: 1, receivedAt: -1 });
workerResponseSchema.index({ workspaceId: 1, memberId: 1, receivedAt: -1 });
workerResponseSchema.index({ workspaceId: 1, cardId: 1, receivedAt: -1 });

module.exports = mongoose.model('WorkerResponse', workerResponseSchema);
