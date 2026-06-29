const crypto = require('crypto');
const mongoose = require('mongoose');

const TOKEN_STATUSES = ['active', 'revoked', 'expired'];

const sessionTokenSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    trim: true,
    default: 'User session'
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
  status: {
    type: String,
    enum: TOKEN_STATUSES,
    default: 'active',
    index: true
  },
  lastUsedAt: Date,
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  createdBy: {
    type: String,
    default: 'system'
  },
  revokedAt: Date,
  revokedBy: String,
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

const tokenPepper = () =>
  process.env.SNEUP_SESSION_TOKEN_PEPPER ||
  process.env.SNEUP_API_TOKEN_PEPPER ||
  process.env.SNEUP_API_KEY ||
  'sneup-development-session-pepper';

sessionTokenSchema.index({ workspaceId: 1, userId: 1, status: 1 });
sessionTokenSchema.index({ tokenPrefix: 1, status: 1 });
sessionTokenSchema.index({ status: 1, expiresAt: 1 });

sessionTokenSchema.statics.generateRawToken = function() {
  return `sneup_session_${crypto.randomBytes(32).toString('base64url')}`;
};

sessionTokenSchema.statics.prefixFor = function(token) {
  return String(token || '').slice(0, 18);
};

sessionTokenSchema.statics.hashToken = function(token) {
  return crypto
    .createHmac('sha256', tokenPepper())
    .update(String(token || ''))
    .digest('hex');
};

sessionTokenSchema.statics.buildSecretRecord = function(token, fields = {}) {
  return {
    ...fields,
    tokenPrefix: this.prefixFor(token),
    tokenHash: this.hashToken(token)
  };
};

sessionTokenSchema.methods.matches = function(token) {
  const expected = Buffer.from(this.tokenHash || '', 'hex');
  const actual = Buffer.from(this.constructor.hashToken(token), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

sessionTokenSchema.methods.isUsable = function(now = new Date()) {
  return this.status === 'active' && this.expiresAt > now;
};

sessionTokenSchema.methods.revoke = function(actor = 'system') {
  this.status = 'revoked';
  this.revokedAt = new Date();
  this.revokedBy = actor;
  return this.save();
};

module.exports = mongoose.model('SessionToken', sessionTokenSchema);
