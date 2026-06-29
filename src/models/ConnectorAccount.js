const mongoose = require('mongoose');

const connectorAccountSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    index: true
  },
  connectorId: {
    type: String,
    required: true,
    index: true
  },
  connectorName: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    index: true
  },
  authType: {
    type: String,
    required: true,
    enum: ['oauth2', 'api_key', 'personal_access_token', 'basic', 'manual', 'webhook']
  },
  status: {
    type: String,
    enum: ['connected', 'needs_attention', 'disabled', 'failed'],
    default: 'connected',
    index: true
  },
  accountName: {
    type: String,
    default: ''
  },
  externalAccountId: {
    type: String,
    index: true
  },
  scopes: [{
    type: String
  }],
  credentials: {
    accessToken: String,
    refreshToken: String,
    apiKey: String,
    username: String,
    password: String,
    tokenType: String,
    expiresAt: Date
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  connectedBy: {
    type: String,
    default: 'local-user'
  },
  lastValidatedAt: Date,
  lastSyncAt: Date,
  lastError: String
}, {
  timestamps: true
});

connectorAccountSchema.index({ workspaceId: 1, connectorId: 1, externalAccountId: 1 });
connectorAccountSchema.index({ connectorId: 1, externalAccountId: 1 });
connectorAccountSchema.index({ status: 1, updatedAt: -1 });

connectorAccountSchema.methods.markFailed = function(error) {
  this.status = 'failed';
  this.lastError = error.message || String(error);
  return this.save();
};

connectorAccountSchema.methods.markValidated = function(metadata = {}) {
  this.status = 'connected';
  this.lastValidatedAt = new Date();
  this.lastError = undefined;
  this.metadata = { ...this.metadata, ...metadata };
  return this.save();
};

const ConnectorAccount = mongoose.model('ConnectorAccount', connectorAccountSchema);

module.exports = ConnectorAccount;
