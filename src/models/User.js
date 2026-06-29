const mongoose = require('mongoose');

const ROLE_ORDER = ['viewer', 'operator', 'manager', 'admin', 'owner', 'service'];

const userSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    index: true
  },
  externalId: {
    type: String,
    trim: true,
    index: true
  },
  email: {
    type: String,
    lowercase: true,
    trim: true,
    index: true
  },
  displayName: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ROLE_ORDER,
    default: 'viewer',
    index: true
  },
  status: {
    type: String,
    enum: ['active', 'invited', 'disabled'],
    default: 'active',
    index: true
  },
  provider: {
    type: String,
    enum: ['local', 'google', 'microsoft', 'github', 'service'],
    default: 'local'
  },
  lastSeenAt: Date,
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

userSchema.index({ workspaceId: 1, email: 1 }, { unique: true, sparse: true });
userSchema.index({ workspaceId: 1, role: 1, status: 1 });

userSchema.methods.hasRoleAtLeast = function(requiredRole) {
  const current = ROLE_ORDER.indexOf(this.role);
  const required = ROLE_ORDER.indexOf(requiredRole);
  return current >= 0 && required >= 0 && current >= required;
};

userSchema.statics.roleOrder = ROLE_ORDER;

module.exports = mongoose.model('User', userSchema);