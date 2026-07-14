const mongoose = require('mongoose');

const jobControlSchema = new mongoose.Schema({
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
  status: {
    type: String,
    enum: ['active', 'paused'],
    default: 'active',
    index: true
  },
  pausedAt: Date,
  pausedBy: String,
  pausedReason: String,
  resumedAt: Date,
  resumedBy: String,
  lastManualRunAt: Date,
  lastManualRunBy: String
}, {
  timestamps: true
});

jobControlSchema.index({ workspaceId: 1, jobName: 1 }, { unique: true });
jobControlSchema.index({ workspaceId: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('JobControl', jobControlSchema);
