const mongoose = require('mongoose');

const SIGNAL_TYPES = [
  'task',
  'project',
  'comment',
  'message',
  'issue',
  'pull_request',
  'document',
  'event',
  'time_entry',
  'allocation',
  'booking',
  'risk',
  'decision',
  'other'
];

const SIGNAL_STATUSES = [
  'open',
  'in_progress',
  'blocked',
  'waiting',
  'done',
  'archived',
  'unknown'
];

const SIGNAL_PRIORITIES = ['low', 'normal', 'high', 'critical', 'unknown'];

const workSignalSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  connectorAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ConnectorAccount',
    required: true,
    index: true
  },
  provider: {
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
  sourceType: {
    type: String,
    enum: SIGNAL_TYPES,
    default: 'other',
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: SIGNAL_STATUSES,
    default: 'unknown',
    index: true
  },
  priority: {
    type: String,
    enum: SIGNAL_PRIORITIES,
    default: 'unknown',
    index: true
  },
  url: String,
  owners: [{
    type: String,
    trim: true
  }],
  labels: [{
    type: String,
    trim: true
  }],
  dueAt: Date,
  providerCreatedAt: Date,
  providerUpdatedAt: Date,
  firstSeenAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  lastSeenAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  evidenceRefs: [{
    provider: String,
    externalId: String,
    url: String,
    label: String,
    type: String
  }],
  raw: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  syncState: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

workSignalSchema.index({
  workspaceId: 1,
  connectorAccountId: 1,
  provider: 1,
  externalId: 1
}, { unique: true });
workSignalSchema.index({ workspaceId: 1, status: 1, priority: 1, dueAt: 1 });
workSignalSchema.index({ workspaceId: 1, provider: 1, sourceType: 1, lastSeenAt: -1 });
workSignalSchema.index({ workspaceId: 1, provider: 1, sourceType: 1, providerCreatedAt: -1 });

workSignalSchema.statics.signalTypes = SIGNAL_TYPES;
workSignalSchema.statics.signalStatuses = SIGNAL_STATUSES;
workSignalSchema.statics.signalPriorities = SIGNAL_PRIORITIES;

module.exports = mongoose.model('WorkSignal', workSignalSchema);
