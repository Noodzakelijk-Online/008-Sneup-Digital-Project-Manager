const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    index: true
  },
  memberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',
    required: true,
    index: true
  },
  boardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    index: true
  },
  cardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Card',
    index: true
  },
  channel: {
    type: String,
    required: true,
    enum: ['trello_comment', 'slack', 'email', 'web_chat', 'api'],
    index: true
  },
  messages: [{
    role: {
      type: String,
      required: true,
      enum: ['user', 'assistant']
    },
    content: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed
    }
  }],
  intent: {
    type: String,
    enum: [
      'get_priorities',
      'ask_for_help',
      'request_reassignment',
      'report_blocker',
      'check_performance',
      'ask_question',
      'provide_update',
      'request_clarification',
      'other'
    ]
  },
  resolved: {
    type: Boolean,
    default: false
  },
  resolution: {
    type: String
  },
  satisfactionRating: {
    type: Number,
    min: 1,
    max: 5
  }
}, {
  timestamps: true
});

// Indexes
conversationSchema.index({ workspaceId: 1, memberId: 1, createdAt: -1 });
conversationSchema.index({ workspaceId: 1, resolved: 1, createdAt: -1 });
conversationSchema.index({ memberId: 1, createdAt: -1 });
conversationSchema.index({ resolved: 1, createdAt: -1 });
conversationSchema.index({ intent: 1 });

// Static methods

// Get recent conversations for a member
conversationSchema.statics.getRecentForMember = function(memberId, limit = 10, workspaceId) {
  return this.find({ memberId, ...(workspaceId ? { workspaceId } : {}) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('memberId boardId cardId');
};

// Get unresolved conversations
conversationSchema.statics.getUnresolved = function(workspaceId) {
  return this.find({ resolved: false, ...(workspaceId ? { workspaceId } : {}) })
    .sort({ createdAt: 1 })
    .populate('memberId boardId cardId');
};

// Get conversations by intent
conversationSchema.statics.getByIntent = function(intent, days = 7, workspaceId) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  return this.find({
    intent,
    ...(workspaceId ? { workspaceId } : {}),
    createdAt: { $gte: startDate }
  })
    .sort({ createdAt: -1 })
    .populate('memberId');
};

// Get conversation statistics
conversationSchema.statics.getStatistics = async function(days = 30, workspaceId) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const conversations = await this.find({
    ...(workspaceId ? { workspaceId } : {}),
    createdAt: { $gte: startDate }
  });

  const byIntent = {};
  const byChannel = {};
  let totalResolved = 0;
  let totalRatings = 0;
  let ratingSum = 0;

  conversations.forEach(conv => {
    // Count by intent
    if (conv.intent) {
      byIntent[conv.intent] = (byIntent[conv.intent] || 0) + 1;
    }

    // Count by channel
    byChannel[conv.channel] = (byChannel[conv.channel] || 0) + 1;

    // Count resolved
    if (conv.resolved) {
      totalResolved++;
    }

    // Average rating
    if (conv.satisfactionRating) {
      totalRatings++;
      ratingSum += conv.satisfactionRating;
    }
  });

  return {
    total: conversations.length,
    resolved: totalResolved,
    resolutionRate: conversations.length > 0 
      ? (totalResolved / conversations.length * 100).toFixed(1)
      : 0,
    averageSatisfaction: totalRatings > 0
      ? (ratingSum / totalRatings).toFixed(2)
      : null,
    byIntent,
    byChannel
  };
};

// Instance methods

// Add message to conversation
conversationSchema.methods.addMessage = function(role, content, metadata = {}) {
  this.messages.push({
    role,
    content,
    timestamp: new Date(),
    metadata
  });
  return this.save();
};

// Mark as resolved
conversationSchema.methods.markResolved = function(resolution) {
  this.resolved = true;
  this.resolution = resolution;
  return this.save();
};

// Set satisfaction rating
conversationSchema.methods.setSatisfactionRating = function(rating) {
  if (rating < 1 || rating > 5) {
    throw new Error('Rating must be between 1 and 5');
  }
  this.satisfactionRating = rating;
  return this.save();
};

// Get conversation context
conversationSchema.methods.getContext = async function() {
  await this.populate('memberId boardId cardId');
  
  return {
    member: this.memberId,
    board: this.boardId,
    card: this.cardId,
    messageCount: this.messages.length,
    duration: this.messages.length > 1
      ? (this.messages[this.messages.length - 1].timestamp - this.messages[0].timestamp) / 1000
      : 0,
    resolved: this.resolved
  };
};

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = Conversation;
