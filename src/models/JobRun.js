const mongoose = require('mongoose');

const jobRunSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  jobName: {
    type: String,
    required: true,
    index: true
  },
  jobType: {
    type: String,
    enum: ['sync', 'analytics', 'intervention', 'performance', 'webhook', 'system'],
    default: 'system',
    index: true
  },
  triggerType: {
    type: String,
    enum: ['scheduled', 'manual', 'startup', 'webhook', 'api', 'worker'],
    default: 'scheduled',
    index: true
  },
  status: {
    type: String,
    enum: ['running', 'succeeded', 'failed', 'skipped'],
    default: 'running',
    index: true
  },
  boardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    index: true
  },
  startedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  finishedAt: Date,
  durationMs: Number,
  processedCount: {
    type: Number,
    default: 0
  },
  successCount: {
    type: Number,
    default: 0
  },
  failureCount: {
    type: Number,
    default: 0
  },
  staleAfterMinutes: {
    type: Number,
    default: 120
  },
  errorMessage: String,
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

jobRunSchema.index({ workspaceId: 1, jobName: 1, status: 1, startedAt: -1 });
jobRunSchema.index({ workspaceId: 1, status: 1, startedAt: -1 });
jobRunSchema.index({ workspaceId: 1, jobType: 1, startedAt: -1 });

module.exports = mongoose.model('JobRun', jobRunSchema);
