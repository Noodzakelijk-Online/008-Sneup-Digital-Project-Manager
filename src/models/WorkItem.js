const mongoose = require('mongoose');

const ITEM_TYPES = ['task', 'project', 'issue', 'pull_request', 'document', 'file', 'folder', 'event', 'message', 'execution', 'test_run', 'risk', 'decision', 'other'];
const ITEM_STATUSES = ['open', 'in_progress', 'blocked', 'waiting', 'done', 'archived', 'unknown'];
const ITEM_PRIORITIES = ['low', 'normal', 'high', 'critical', 'unknown'];

const workItemSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  sourceProvider: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  connectorAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ConnectorAccount',
    required: true,
    index: true
  },
  sourceSignalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WorkSignal',
    index: true
  },
  externalId: {
    type: String,
    required: true,
    trim: true
  },
  canonicalKey: {
    type: String,
    required: true,
    trim: true,
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
  itemType: {
    type: String,
    enum: ITEM_TYPES,
    default: 'other',
    index: true
  },
  status: {
    type: String,
    enum: ITEM_STATUSES,
    default: 'unknown',
    index: true
  },
  priority: {
    type: String,
    enum: ITEM_PRIORITIES,
    default: 'unknown',
    index: true
  },
  url: String,
  ownerKeys: [{
    type: String,
    trim: true
  }],
  labelKeys: [{
    type: String,
    trim: true
  }],
  containerKey: {
    type: String,
    default: ''
  },
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

workItemSchema.index({ workspaceId: 1, sourceProvider: 1, externalId: 1 }, { unique: true });
workItemSchema.index({ workspaceId: 1, status: 1, priority: 1, dueAt: 1 });
workItemSchema.index({ workspaceId: 1, canonicalKey: 1 });
workItemSchema.index({ workspaceId: 1, ownerKeys: 1, status: 1 });

workItemSchema.statics.itemTypes = ITEM_TYPES;
workItemSchema.statics.itemStatuses = ITEM_STATUSES;
workItemSchema.statics.itemPriorities = ITEM_PRIORITIES;

module.exports = mongoose.models.WorkItem || mongoose.model('WorkItem', workItemSchema);
