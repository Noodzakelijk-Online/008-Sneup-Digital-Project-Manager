const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    index: true
  },
  trelloId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  cardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Card',
    required: true,
    index: true
  },
  memberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',
    index: true
  },
  text: {
    type: String,
    required: true
  },
  sentiment: {
    score: {
      type: Number,
      default: 0
    },
    classification: {
      type: String,
      enum: ['very_negative', 'negative', 'neutral', 'positive', 'very_positive'],
      default: 'neutral'
    }
  },
  entities: {
    people: [String],
    dates: [String],
    skills: [String],
    roles: [String]
  },
  isActionItem: {
    type: Boolean,
    default: false
  },
  actionTarget: {
    type: {
      type: String,
      enum: ['member', 'general']
    },
    value: mongoose.Schema.Types.Mixed
  },
  createdAt: {
    type: Date,
    required: true,
    index: true
  },
  lastSync: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false
});

// Indexes for efficient queries
commentSchema.index({ workspaceId: 1, cardId: 1, createdAt: -1 });
commentSchema.index({ workspaceId: 1, memberId: 1, createdAt: -1 });
commentSchema.index({ cardId: 1, createdAt: -1 });
commentSchema.index({ memberId: 1, createdAt: -1 });
commentSchema.index({ isActionItem: 1 });

// Method to check if comment mentions a member
commentSchema.methods.mentionsMember = function(username) {
  if (!this.text) return false;
  return this.text.toLowerCase().includes(`@${username.toLowerCase()}`);
};

// Method to extract mentions from comment
commentSchema.methods.extractMentions = function() {
  if (!this.text) return [];
  const mentions = this.text.match(/@(\w+)/g) || [];
  return mentions.map(mention => mention.substring(1));
};

// Static method to find action items
commentSchema.statics.findActionItems = function() {
  return this.find({
    isActionItem: true
  }).populate('cardId memberId');
};

// Static method to find comments by sentiment
commentSchema.statics.findBySentiment = function(classification) {
  return this.find({
    'sentiment.classification': classification
  }).populate('cardId memberId');
};

const Comment = mongoose.model('Comment', commentSchema);

module.exports = Comment;
