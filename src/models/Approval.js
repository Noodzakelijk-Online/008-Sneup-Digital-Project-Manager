const mongoose = require('mongoose');

const approvalSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
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
  requestedAction: {
    type: String,
    required: true
  },
  decision: {
    type: String,
    enum: ['approved', 'rejected', 'change_requested'],
    required: true,
    index: true
  },
  decidedBy: {
    type: String,
    default: 'robert'
  },
  decisionReason: String,
  approvedPayloadSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  decidedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

approvalSchema.index({ recommendationId: 1, decidedAt: -1 });
approvalSchema.index({ workspaceId: 1, recommendationId: 1, decidedAt: -1 });

module.exports = mongoose.model('Approval', approvalSchema);