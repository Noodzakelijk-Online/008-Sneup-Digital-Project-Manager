const mongoose = require('mongoose');

const learningSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    index: true
  },
  type: {
    type: String,
    enum: ['pattern', 'feedback', 'prediction', 'recommendation'],
    required: true,
    index: true
  },
  category: {
    type: String,
    enum: ['workflow', 'team', 'bottleneck', 'risk', 'assignment', 'recommendation'],
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
    decision: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'change_requested', 'executed'],
      default: 'pending'
    },
    actionType: String,
    riskLevel: String,
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
learningSchema.index({ workspaceId: 1, type: 1, category: 1 });
learningSchema.index({ workspaceId: 1, boardId: 1, type: 1 });
learningSchema.index(
  { workspaceId: 1, type: 1, category: 1, 'feedback.recommendationId': 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'feedback',
      category: 'recommendation',
      'feedback.recommendationId': { $exists: true }
    }
  }
);
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
learningSchema.statics.recordRecommendationFeedback = function(payload = {}) {
  if (!payload.workspaceId || !payload.recommendationId) {
    throw new Error('workspaceId and recommendationId are required for recommendation feedback');
  }

  const now = new Date();
  return this.findOneAndUpdate(
    {
      workspaceId: payload.workspaceId,
      type: 'feedback',
      category: 'recommendation',
      'feedback.recommendationId': payload.recommendationId
    },
    {
      $set: {
        workspaceId: payload.workspaceId,
        boardId: payload.boardId,
        type: 'feedback',
        category: 'recommendation',
        feedback: {
          recommendationId: payload.recommendationId,
          decision: payload.decision || 'pending',
          actionType: payload.actionType,
          riskLevel: payload.riskLevel,
          accepted: payload.accepted === true,
          executed: payload.executed === true,
          outcome: payload.outcome || 'unknown',
          feedbackDate: now
        }
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

learningSchema.statics.recordFeedback = function(recommendationId, accepted, executed, outcome, notes, options = {}) {
  return this.recordRecommendationFeedback({
    workspaceId: options.workspaceId,
    recommendationId,
    decision: executed ? 'executed' : accepted ? 'approved' : 'rejected',
    accepted,
    executed,
    outcome,
    notes
  });
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
