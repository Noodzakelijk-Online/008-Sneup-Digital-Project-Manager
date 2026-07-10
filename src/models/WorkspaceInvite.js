const crypto = require('crypto');
const mongoose = require('mongoose');

const INVITE_STATUSES = ['pending', 'accepted', 'revoked', 'expired'];

const workspaceInviteSchema = new mongoose.Schema({
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
  email: {
    type: String,
    required: true,
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
    enum: ['viewer', 'operator', 'manager', 'admin', 'owner', 'service'],
    default: 'viewer'
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
    enum: INVITE_STATUSES,
    default: 'pending',
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  createdBy: {
    type: String,
    default: 'system'
  },
  acceptedAt: Date,
  revokedAt: Date,
  revokedBy: String,
  delivery: {
    mode: {
      type: String,
      enum: ['manual', 'email'],
      default: 'manual'
    },
    status: {
      type: String,
      enum: ['not_sent', 'sent', 'failed'],
      default: 'not_sent'
    },
    attemptedAt: Date,
    sentAt: Date,
    failureCode: String
  }
}, {
  timestamps: true
});

const tokenPepper = () =>
  process.env.SNEUP_INVITE_TOKEN_PEPPER ||
  process.env.SNEUP_SESSION_TOKEN_PEPPER ||
  process.env.SNEUP_API_TOKEN_PEPPER ||
  process.env.SNEUP_API_KEY ||
  'sneup-development-invite-pepper';

workspaceInviteSchema.index({ workspaceId: 1, userId: 1, status: 1 });
workspaceInviteSchema.index({ workspaceId: 1, email: 1, status: 1 });
workspaceInviteSchema.index({ status: 1, expiresAt: 1 });

workspaceInviteSchema.statics.generateRawToken = function() {
  return `sneup_invite_${crypto.randomBytes(32).toString('base64url')}`;
};

workspaceInviteSchema.statics.prefixFor = function(token) {
  return String(token || '').slice(0, 18);
};

workspaceInviteSchema.statics.hashToken = function(token) {
  return crypto
    .createHmac('sha256', tokenPepper())
    .update(String(token || ''))
    .digest('hex');
};

workspaceInviteSchema.statics.buildSecretRecord = function(token, fields = {}) {
  return {
    ...fields,
    tokenPrefix: this.prefixFor(token),
    tokenHash: this.hashToken(token)
  };
};

workspaceInviteSchema.methods.matches = function(token) {
  const expected = Buffer.from(this.tokenHash || '', 'hex');
  const actual = Buffer.from(this.constructor.hashToken(token), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

workspaceInviteSchema.methods.isUsable = function(now = new Date()) {
  return this.status === 'pending' && this.expiresAt > now;
};

workspaceInviteSchema.methods.revoke = function(actor = 'system') {
  this.status = 'revoked';
  this.revokedAt = new Date();
  this.revokedBy = actor;
  return this.save();
};

workspaceInviteSchema.statics.statuses = INVITE_STATUSES;

module.exports = mongoose.model('WorkspaceInvite', workspaceInviteSchema);
