const mongoose = require('mongoose');

const analyticsSchema = new mongoose.Schema({
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
  date: {
    type: Date,
    required: true,
    index: true
  },
  cardCount: {
    total: {
      type: Number,
      default: 0
    },
    byList: [{
      listId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'List'
      },
      count: Number
    }]
  },
  velocity: {
    cardsPerDay: {
      type: Number,
      default: 0
    },
    cardsPerWeek: {
      type: Number,
      default: 0
    },
    pointsPerDay: {
      type: Number,
      default: 0
    },
    pointsPerWeek: {
      type: Number,
      default: 0
    }
  },
  cycleTime: {
    average: {
      type: Number, // in hours
      default: 0
    },
    byCardType: [{
      type: String,
      averageTime: Number
    }]
  },
  leadTime: {
    average: {
      type: Number, // in hours
      default: 0
    },
    byCardType: [{
      type: String,
      averageTime: Number
    }]
  },
  bottlenecks: [{
    listId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'List'
    },
    listName: String,
    severity: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    averageTimeInList: Number,
    cardCount: Number,
    trend: {
      type: String,
      enum: ['improving', 'stable', 'worsening'],
      default: 'stable'
    }
  }],
  teamPerformance: {
    overallUtilization: {
      type: Number,
      default: 0
    },
    memberUtilization: [{
      memberId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Member'
      },
      utilization: Number,
      cardsCompleted: Number,
      averageCompletionTime: Number
    }]
  },
  projectHealth: {
    overall: {
      type: String,
      enum: ['healthy', 'at_risk', 'critical'],
      default: 'healthy'
    },
    riskFactors: [String],
    onTrackPercentage: {
      type: Number,
      default: 100
    },
    delayedCards: {
      type: Number,
      default: 0
    },
    blockedCards: {
      type: Number,
      default: 0
    }
  },
  predictions: {
    estimatedCompletionDate: Date,
    confidenceLevel: {
      type: Number,
      default: 0
    },
    riskAreas: [String]
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false
});

// Indexes for efficient queries
analyticsSchema.index({ workspaceId: 1, boardId: 1, date: -1 });
analyticsSchema.index({ workspaceId: 1, 'projectHealth.overall': 1 });
analyticsSchema.index({ boardId: 1, date: -1 });
analyticsSchema.index({ 'projectHealth.overall': 1 });
analyticsSchema.index({ date: -1 });

// Static method to get latest analytics for a board
analyticsSchema.statics.getLatest = function(boardId, workspaceId) {
  return this.findOne({ boardId, ...(workspaceId ? { workspaceId } : {}) })
    .sort({ date: -1 })
    .populate('boardId')
    .populate('bottlenecks.listId')
    .populate('teamPerformance.memberUtilization.memberId');
};

// Static method to get analytics history for a board
analyticsSchema.statics.getHistory = function(boardId, days = 30, workspaceId) {
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return this.find({
    boardId,
    ...(workspaceId ? { workspaceId } : {}),
    date: { $gte: cutoffDate }
  })
  .sort({ date: -1 })
  .populate('boardId');
};

// Static method to get boards with critical health
analyticsSchema.statics.getCriticalBoards = function(workspaceId) {
  return this.aggregate([
    ...(workspaceId ? [{ $match: { workspaceId } }] : []),
    {
      $sort: { date: -1 }
    },
    {
      $group: {
        _id: '$boardId',
        latestAnalytics: { $first: '$$ROOT' }
      }
    },
    {
      $replaceRoot: { newRoot: '$latestAnalytics' }
    },
    {
      $match: {
        'projectHealth.overall': 'critical'
      }
    }
  ]);
};

// Method to compare with previous analytics
analyticsSchema.methods.compareWithPrevious = async function() {
  const previous = await this.constructor.findOne({
    boardId: this.boardId,
    date: { $lt: this.date }
  }).sort({ date: -1 });
  
  if (!previous) {
    return null;
  }
  
  return {
    velocityChange: {
      cardsPerDay: this.velocity.cardsPerDay - previous.velocity.cardsPerDay,
      cardsPerWeek: this.velocity.cardsPerWeek - previous.velocity.cardsPerWeek
    },
    cycleTimeChange: this.cycleTime.average - previous.cycleTime.average,
    healthChange: {
      from: previous.projectHealth.overall,
      to: this.projectHealth.overall,
      improved: this.projectHealth.onTrackPercentage > previous.projectHealth.onTrackPercentage
    },
    bottleneckChange: {
      count: this.bottlenecks.length - previous.bottlenecks.length,
      new: this.bottlenecks.filter(b => 
        !previous.bottlenecks.some(pb => pb.listId.toString() === b.listId.toString())
      ),
      resolved: previous.bottlenecks.filter(pb => 
        !this.bottlenecks.some(b => b.listId.toString() === pb.listId.toString())
      )
    }
  };
};

const Analytics = mongoose.model('Analytics', analyticsSchema);

module.exports = Analytics;
