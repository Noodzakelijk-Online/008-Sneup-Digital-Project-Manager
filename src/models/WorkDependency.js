const mongoose = require('mongoose');

const workDependencySchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  sourceItemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WorkItem',
    required: true,
    index: true
  },
  targetItemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WorkItem',
    required: true,
    index: true
  },
  dependencyType: {
    type: String,
    enum: ['blocks', 'blocked_by', 'relates_to', 'duplicates', 'depends_on', 'unknown'],
    default: 'unknown',
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
  confidence: {
    type: Number,
    min: 0,
    max: 1,
    default: 1
  },
  evidenceRefs: [{
    provider: String,
    externalId: String,
    url: String,
    label: String,
    type: String
  }],
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

workDependencySchema.index({ workspaceId: 1, sourceProvider: 1, externalId: 1 }, { unique: true });
workDependencySchema.index({ workspaceId: 1, dependencyType: 1, updatedAt: -1 });

module.exports = mongoose.models.WorkDependency || mongoose.model('WorkDependency', workDependencySchema);
