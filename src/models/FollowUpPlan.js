const mongoose = require('mongoose');

const followUpPlanSchema = new mongoose.Schema({
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
  reason: String,
  nextAction: String,
  dueAt: {
    type: Date,
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['scheduled', 'due', 'resolved', 'cancelled', 'escalated'],
    default: 'scheduled',
    index: true
  },
  resolvedAt: Date,
  resolutionNote: String
}, {
  timestamps: true
});

followUpPlanSchema.index({ status: 1, dueAt: 1 });
followUpPlanSchema.index({ boardId: 1, status: 1 });
followUpPlanSchema.index({ workspaceId: 1, status: 1, dueAt: 1 });
followUpPlanSchema.index({ workspaceId: 1, boardId: 1, status: 1 });

module.exports = mongoose.model('FollowUpPlan', followUpPlanSchema);