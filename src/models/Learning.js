const mongoose = require('mongoose');

const learningSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['pattern', 'feedback', 'prediction', 'recommendation'],
    required: true,
    index: true
  },
  category: {
    type: String,
    enum: ['workflow', 'team', 'bottleneck', 'risk', 'assignment'],
    required: true,
    index: true
  },
  boardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    index: true
  },
  pattern: {
    description: String,
    confidence: {
      type: Number,
      default: 0
    },
    occurrences: {
      type: Number,
      default: 1
    },
    lastSeen: {
      type: Date,
      default: Date.now
    },
    data: mongoose.Schema.Types.Mixed
  },
  feedback: {
    recommendationId: mongoose.Schema.Types.ObjectId,
    accepted: {
      type: Boolean,
      default: false
    },
    executed: {
      type: Boolean,
      default: false
    },
    outcome: {
      type: String,
      enum: ['success', 'failure', 'partial', 'unknown'],
      default: 'unknown'
    },
    notes: String,
    feedbackDate: Date
  },
  prediction: {
    target: String,
    predictedValue: mongoose.Schema.Types.Mixed,
    actualValue: mongoose.Schema.Types.Mixed,
    accuracy: Number,
    predictionDate: Date,
    verificationDate: Date
  },
  recommendation: {
    action: String,
    reason: String,
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'executed'],
      default: 'pending'
    },
    targetEntity: {
      type: String,
      id: mongoose.Schema.Types.ObjectId
    }
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
learningSchema.index({ type: 1, category: 1 });
learningSchema.index({ boardId: 1, type: 1 });
learningSchema.index({ 'pattern.confidence': -1 });
learningSchema.index({ 'recommendation.status': 1 });

// Static method to record a pattern
learningSchema.statics.recordPattern = async function(category, boardId, description, data) {
  // Check if pattern already exists
  const existingPattern = await this.findOne({
    type: 'pattern',
    category,
    boardId,
    'pattern.description': description
  });
  
  if (existingPattern) {
    // Update existing pattern
    existingPattern.pattern.occurrences += 1;
    existingPattern.pattern.lastSeen = new Date();
    existingPattern.pattern.confidence = Math.min(
      existingPattern.pattern.confidence + 0.1,
      1.0
    );
    existingPattern.pattern.data = data;
    await existingPattern.save();
    return existingPattern;
  } else {
    // Create new pattern
    const newPattern = new this({
      type: 'pattern',
      category,
      boardId,
      pattern: {
        description,
        confidence: 0.5,
        occurrences: 1,
        lastSeen: new Date(),
        data
      }
    });
    await newPattern.save();
    return newPattern;
  }
};

// Static method to record feedback
learningSchema.statics.recordFeedback = async function(recommendationId, accepted, executed, outcome, notes) {
  const feedback = new this({
    type: 'feedback',
    category: 'recommendation',
    feedback: {
      recommendationId,
      accepted,
      executed,
      outcome,
      notes,
      feedbackDate: new Date()
    }
  });
  await feedback.save();
  return feedback;
};

// Static method to get patterns by category
learningSchema.statics.getPatternsByCategory = function(category, minConfidence = 0.5) {
  return this.find({
    type: 'pattern',
    category,
    'pattern.confidence': { $gte: minConfidence }
  }).sort({ 'pattern.confidence': -1 });
};

// Static method to get successful recommendations
learningSchema.statics.getSuccessfulRecommendations = function(category) {
  return this.find({
    type: 'feedback',
    category,
    'feedback.outcome': 'success'
  });
};

const Learning = mongoose.model('Learning', learningSchema);

module.exports = Learning;
