const mongoose = require('mongoose');

const boardHealthSnapshotSchema = new mongoose.Schema({
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
  healthScore: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  healthStatus: {
    type: String,
    enum: ['healthy', 'watch', 'at_risk', 'critical'],
    required: true,
    index: true
  },
  generatedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  counts: {
    activeCards: { type: Number, default: 0 },
    overdueCards: { type: Number, default: 0 },
    staleCards: { type: Number, default: 0 },
    blockedCards: { type: Number, default: 0 },
    unassignedCards: { type: Number, default: 0 },
    missingNextActionCards: { type: Number, default: 0 },
    highRiskCards: { type: Number, default: 0 },
    robertQueueCandidates: { type: Number, default: 0 },
    vaReadyCandidates: { type: Number, default: 0 },
    findings: { type: Number, default: 0 }
  },
  findingsByType: {
    type: Map,
    of: Number,
    default: {}
  },
  topRisks: [{
    cardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Card'
    },
    cardName: String,
    findingType: String,
    severity: String,
    reason: String
  }],
  summary: String
}, {
  timestamps: true
});

boardHealthSnapshotSchema.index({ boardId: 1, generatedAt: -1 });
boardHealthSnapshotSchema.index({ workspaceId: 1, boardId: 1, generatedAt: -1 });

module.exports = mongoose.model('BoardHealthSnapshot', boardHealthSnapshotSchema);