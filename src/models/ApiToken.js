const crypto = require('crypto');
const mongoose = require('mongoose');
const { getTokenPepper } = require('../utils/securityConfiguration');

const TOKEN_STATUSES = ['active', 'revoked', 'expired'];
const TOKEN_ROLES = ['viewer', 'operator', 'manager', 'admin', 'owner', 'service'];

const apiTokenSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  tokenPrefix: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  tokenHash: {
    type: String,
    required: true,
    select: false
  },
  role: {
    type: String,
    enum: TOKEN_ROLES,
    default: 'service',
    index: true
  },
  scopes: [{
    type: String,
    trim: true
  }],
  status: {
    type: String,
    enum: TOKEN_STATUSES,
    default: 'active',
    index: true
  },
  lastUsedAt: Date,
  expiresAt: {
    type: Date,
    index: true
  },
  createdBy: {
    type: String,
    default: 'system'
  },
  revokedAt: Date,
  revokedBy: String
}, {
  timestamps: true
});

const tokenPepper = () => getTokenPepper(
  'SNEUP_API_TOKEN_PEPPER',
  'sneup-development-token-pepper'
);

apiTokenSchema.index({ workspaceId: 1, tokenPrefix: 1 });
apiTokenSchema.index({ status: 1, expiresAt: 1 });

apiTokenSchema.statics.prefixFor = function(token) {
  return String(token || '').slice(0, 10);
};

apiTokenSchema.statics.hashToken = function(token) {
  return crypto
    .createHmac('sha256', tokenPepper())
    .update(String(token || ''))
    .digest('hex');
};

apiTokenSchema.statics.buildSecretRecord = function(token, fields = {}) {
  return {
    ...fields,
    tokenPrefix: this.prefixFor(token),
    tokenHash: this.hashToken(token)
  };
};

apiTokenSchema.methods.matches = function(token) {
  const expected = Buffer.from(this.tokenHash || '', 'hex');
  const actual = Buffer.from(this.constructor.hashToken(token), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

apiTokenSchema.methods.isUsable = function(now = new Date()) {
  return this.status === 'active' && (!this.expiresAt || this.expiresAt > now);
};

apiTokenSchema.methods.revoke = function(actor = 'system') {
  this.status = 'revoked';
  this.revokedAt = new Date();
  this.revokedBy = actor;
  return this.save();
};

module.exports = mongoose.model('ApiToken', apiTokenSchema);
