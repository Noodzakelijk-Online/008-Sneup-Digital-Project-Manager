const mongoose = require('mongoose');

const workspaceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['active', 'suspended', 'archived'],
    default: 'active',
    index: true
  },
  plan: {
    type: String,
    enum: ['local', 'team', 'enterprise'],
    default: 'local'
  },
  settings: {
    requireApprovalForTrelloWrites: {
      type: Boolean,
      default: true
    },
    defaultDecisionOwner: {
      type: String,
      enum: ['robert', 'va', 'team', 'system'],
      default: 'robert'
    }
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

workspaceSchema.index({ slug: 1 }, { unique: true });
workspaceSchema.index({ status: 1, updatedAt: -1 });

workspaceSchema.statics.defaultWorkspaceKey = function() {
  return process.env.SNEUP_DEFAULT_WORKSPACE_ID || 'default';
};

workspaceSchema.statics.defaultWorkspaceName = function() {
  return process.env.SNEUP_DEFAULT_WORKSPACE_NAME || 'Sneup Local Workspace';
};

module.exports = mongoose.model('Workspace', workspaceSchema);