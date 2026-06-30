const mongoose = require('mongoose');

const workActorSchema = new mongoose.Schema({
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
  displayName: {
    type: String,
    required: true,
    trim: true
  },
  actorType: {
    type: String,
    enum: ['person', 'team', 'service', 'unknown'],
    default: 'unknown',
    index: true
  },
  connectorAccountIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ConnectorAccount'
  }],
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

workActorSchema.index({ workspaceId: 1, sourceProvider: 1, externalId: 1 }, { unique: true });
workActorSchema.index({ workspaceId: 1, displayName: 1 });

module.exports = mongoose.models.WorkActor || mongoose.model('WorkActor', workActorSchema);
