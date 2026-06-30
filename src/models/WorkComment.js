const mongoose = require('mongoose');

const workCommentSchema = new mongoose.Schema({
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
  authorKey: {
    type: String,
    default: ''
  },
  body: {
    type: String,
    default: ''
  },
  url: String,
  providerCreatedAt: Date,
  providerUpdatedAt: Date,
  lastSeenAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  raw: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

workCommentSchema.index({ workspaceId: 1, sourceProvider: 1, externalId: 1 }, { unique: true });
workCommentSchema.index({ workspaceId: 1, workItemId: 1, providerCreatedAt: -1 });

module.exports = mongoose.model('WorkComment', workCommentSchema);
