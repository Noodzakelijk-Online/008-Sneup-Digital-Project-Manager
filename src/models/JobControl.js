const mongoose = require('mongoose');

const jobControlSchema = new mongoose.Schema({
  jobName: {
    type: String,
    required: true,
    unique: true,
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

jobControlSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.model('JobControl', jobControlSchema);
