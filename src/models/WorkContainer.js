const mongoose = require('mongoose');

const CONTAINER_TYPES = ['board', 'project', 'space', 'repository', 'channel', 'folder', 'calendar', 'account', 'unknown'];

const workContainerSchema = new mongoose.Schema({
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
  externalId: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  containerType: {
    type: String,
    enum: CONTAINER_TYPES,
    default: 'unknown',
    index: true
  },
  connectorAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ConnectorAccount',
    index: true
  },
  url: String,
  lastSeenAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

workContainerSchema.index({ workspaceId: 1, sourceProvider: 1, externalId: 1 }, { unique: true });
workContainerSchema.index({ workspaceId: 1, containerType: 1, lastSeenAt: -1 });
workContainerSchema.statics.containerTypes = CONTAINER_TYPES;

module.exports = mongoose.model('WorkContainer', workContainerSchema);
