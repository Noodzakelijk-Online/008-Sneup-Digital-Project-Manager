const mongoose = require('mongoose');

const workEventSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  workItemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WorkItem',
    index: true
  },
  sourceSignalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WorkSignal',
    index: true
  },
  sourceProvider: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  externalId: {
    type: String,
    required: true,
    trim: true
  },
  eventKey: {
    type: String,
    required: true,
    trim: true
  },
  eventType: {
    type: String,
    enum: ['created', 'updated', 'commented', 'status_changed', 'assigned', 'synced', 'unknown'],
    default: 'synced',
    index: true
  },
  occurredAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  summary: {
    type: String,
    default: ''
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

workEventSchema.index({ workspaceId: 1, sourceProvider: 1, eventKey: 1 }, { unique: true });
workEventSchema.index({ workspaceId: 1, workItemId: 1, occurredAt: -1 });

module.exports = mongoose.models.WorkEvent || mongoose.model('WorkEvent', workEventSchema);
