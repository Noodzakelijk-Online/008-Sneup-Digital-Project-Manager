const mongoose = require('mongoose');

const interventionSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    index: true
  },
  boardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    required: true,
    index: true
  },
  cardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Card',
    index: true
  },
  memberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: [
      'comment',
      'reassign',
      'escalate',
      'move_card',
      'add_label',
      'set_due_date',
      'add_checklist',
      'follow_up',
      'performance_notification'
    ],
    index: true
  },
  trigger: {
    type: String,
    required: true,
    enum: [
      'card_stuck',
      'no_activity',
      'overdue',
      'member_overloaded',
      'member_underperforming',
      'blocking_others',
      'no_response_to_followup',
      'manual_request',
      'performance_milestone'
    ]
  },
  severity: {
    type: String,
    required: true,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  action: {
    type: String,
    required: true
  },
  message: {
    type: String
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'awaiting_approval', 'executing', 'executed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  executedAt: {
    type: Date
  },
  response: {
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Member'
    },
    respondedAt: Date,
    responseText: String,
    responseType: {
      type: String,
      enum: ['acknowledged', 'completed', 'blocked', 'needs_help', 'ignored']
    }
  },
  escalation: {
    escalated: {
      type: Boolean,
      default: false
    },
    escalatedAt: Date,
    escalatedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Member'
    },
    queuedAt: Date,
    queuedInterventionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Intervention'
    },
    reason: String
  },
  outcome: {
    type: String,
    enum: ['successful', 'unsuccessful', 'pending', 'escalated'],
    default: 'pending'
  },
  followUpInterventionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Intervention'
  }
}, {
  timestamps: true
});

// Indexes for performance
interventionSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });
interventionSchema.index({ workspaceId: 1, boardId: 1, createdAt: -1 });
interventionSchema.index({ createdAt: -1 });
interventionSchema.index({ boardId: 1, createdAt: -1 });
interventionSchema.index({ memberId: 1, createdAt: -1 });
interventionSchema.index({ status: 1, createdAt: -1 });
interventionSchema.index({ type: 1, trigger: 1 });
interventionSchema.index({ workspaceId: 1, boardId: 1, cardId: 1, memberId: 1, type: 1, trigger: 1, status: 1, createdAt: -1 });

// Static methods

// Get pending interventions
interventionSchema.statics.getPending = function() {
  return this.find({ status: 'pending' })
    .sort({ severity: -1, createdAt: 1 })
    .populate('boardId cardId memberId');
};

// Get interventions needing follow-up
interventionSchema.statics.getNeedingFollowUp = function(options = {}) {
  const followUpThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours
  const query = {
    status: 'executed',
    type: { $in: ['comment', 'follow_up'] },
    'response.respondedAt': { $exists: false },
    followUpInterventionId: { $exists: false },
    executedAt: { $lt: followUpThreshold }
  };
  if (options.workspaceId) query.workspaceId = options.workspaceId;

  return this.find(query)
    .sort({ severity: -1, executedAt: 1 })
    .populate('boardId cardId memberId');
};

// Get interventions needing escalation
interventionSchema.statics.getNeedingEscalation = function(options = {}) {
  const escalationThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours
  const query = {
    status: 'executed',
    'escalation.escalated': false,
    'escalation.queuedAt': { $exists: false },
    'response.respondedAt': { $exists: false },
    executedAt: { $lt: escalationThreshold },
    severity: { $in: ['high', 'critical'] }
  };
  if (options.workspaceId) query.workspaceId = options.workspaceId;

  return this.find(query)
    .sort({ severity: -1, executedAt: 1 })
    .populate('boardId cardId memberId');
};

// Get intervention history for a card
interventionSchema.statics.getCardHistory = function(cardId) {
  return this.find({ cardId })
    .sort({ createdAt: -1 })
    .populate('memberId');
};

// Get intervention history for a member
interventionSchema.statics.getMemberHistory = function(memberId, days = 30) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  return this.find({
    memberId,
    createdAt: { $gte: startDate }
  })
    .sort({ createdAt: -1 })
    .populate('cardId boardId');
};

// Get member response rate
interventionSchema.statics.getMemberResponseRate = async function(memberId, days = 30) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const interventions = await this.find({
    memberId,
    type: { $in: ['comment', 'follow_up'] },
    status: 'executed',
    createdAt: { $gte: startDate }
  });
  
  const responded = interventions.filter(i => i.response && i.response.respondedAt).length;
  const total = interventions.length;
  
  return {
    total,
    responded,
    ignored: total - responded,
    responseRate: total > 0 ? (responded / total * 100).toFixed(1) : 0
  };
};

// Get intervention success rate by type
interventionSchema.statics.getSuccessRate = async function(type, days = 30) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const interventions = await this.find({
    type,
    status: 'executed',
    createdAt: { $gte: startDate }
  });
  
  const successful = interventions.filter(i => i.outcome === 'successful').length;
  const total = interventions.length;
  
  return {
    type,
    total,
    successful,
    unsuccessful: interventions.filter(i => i.outcome === 'unsuccessful').length,
    escalated: interventions.filter(i => i.outcome === 'escalated').length,
    successRate: total > 0 ? (successful / total * 100).toFixed(1) : 0
  };
};

// Instance methods

// Mark as executed
interventionSchema.methods.markExecuted = function(metadata = {}) {
  this.status = 'executed';
  this.executedAt = new Date();
  if (Object.keys(metadata).length > 0) {
    this.metadata = { ...(this.metadata || {}), ...metadata };
  }
  return this.save();
};

// Record response
interventionSchema.methods.recordResponse = function(memberId, responseText, responseType) {
  this.response = {
    memberId,
    respondedAt: new Date(),
    responseText,
    responseType
  };
  
  // Update outcome based on response type
  if (responseType === 'completed' || responseType === 'acknowledged') {
    this.outcome = 'successful';
  } else if (responseType === 'blocked' || responseType === 'needs_help') {
    this.outcome = 'unsuccessful';
  }
  
  return this.save();
};

// Escalate intervention
interventionSchema.methods.escalate = function(escalatedTo, reason) {
  this.escalation = {
    escalated: true,
    escalatedAt: new Date(),
    escalatedTo,
    reason
  };
  this.outcome = 'escalated';
  return this.save();
};

// Mark as failed
interventionSchema.methods.markFailed = function(error) {
  this.status = 'failed';
  this.metadata = { ...(this.metadata || {}), error: error.message };
  return this.save();
};

const Intervention = mongoose.model('Intervention', interventionSchema);

module.exports = Intervention;
