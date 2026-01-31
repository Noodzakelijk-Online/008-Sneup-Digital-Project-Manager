const mongoose = require('mongoose');

const performanceSchema = new mongoose.Schema({
  memberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',
    required: true,
    index: true
  },
  boardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    required: true,
    index: true
  },
  period: {
    type: String,
    required: true,
    enum: ['daily', 'weekly', 'monthly'],
    index: true
  },
  startDate: {
    type: Date,
    required: true,
    index: true
  },
  endDate: {
    type: Date,
    required: true
  },
  metrics: {
    cardsAssigned: {
      type: Number,
      default: 0
    },
    cardsCompleted: {
      type: Number,
      default: 0
    },
    cardsOnTime: {
      type: Number,
      default: 0
    },
    cardsLate: {
      type: Number,
      default: 0
    },
    cardsOverdue: {
      type: Number,
      default: 0
    },
    averageCycleTime: {
      type: Number,
      default: 0
    },
    interventionsReceived: {
      type: Number,
      default: 0
    },
    interventionsResponded: {
      type: Number,
      default: 0
    },
    interventionsIgnored: {
      type: Number,
      default: 0
    },
    escalationsReceived: {
      type: Number,
      default: 0
    },
    commentsPosted: {
      type: Number,
      default: 0
    },
    averageResponseTime: {
      type: Number,
      default: 0
    }
  },
  calculated: {
    completionRate: {
      type: Number,
      default: 0
    },
    onTimeDeliveryRate: {
      type: Number,
      default: 0
    },
    responseRate: {
      type: Number,
      default: 0
    },
    workloadLevel: {
      type: String,
      enum: ['light', 'normal', 'heavy', 'overloaded'],
      default: 'normal'
    },
    performanceScore: {
      type: Number,
      default: 0
    },
    performanceGrade: {
      type: String,
      enum: ['A', 'B', 'C', 'D', 'F'],
      default: 'C'
    }
  },
  comparison: {
    teamAverage: {
      cardsCompleted: Number,
      cycleTime: Number,
      onTimeRate: Number
    },
    percentile: {
      type: Number,
      default: 50
    },
    rank: Number,
    totalMembers: Number
  },
  flags: [{
    type: {
      type: String,
      enum: [
        'underperforming',
        'overloaded',
        'non_responsive',
        'consistently_late',
        'high_performer',
        'needs_support'
      ]
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical']
    },
    description: String,
    flaggedAt: {
      type: Date,
      default: Date.now
    }
  }],
  notes: String
}, {
  timestamps: true
});

// Indexes
performanceSchema.index({ memberId: 1, period: 1, startDate: -1 });
performanceSchema.index({ boardId: 1, period: 1, startDate: -1 });
performanceSchema.index({ 'calculated.performanceScore': -1 });
performanceSchema.index({ 'flags.type': 1 });

// Static methods

// Get latest performance for a member
performanceSchema.statics.getLatest = function(memberId, period = 'weekly') {
  return this.findOne({ memberId, period })
    .sort({ startDate: -1 })
    .populate('memberId boardId');
};

// Get performance history
performanceSchema.statics.getHistory = function(memberId, period = 'weekly', limit = 12) {
  return this.find({ memberId, period })
    .sort({ startDate: -1 })
    .limit(limit)
    .populate('memberId boardId');
};

// Get team performance for a board
performanceSchema.statics.getTeamPerformance = function(boardId, period = 'weekly') {
  return this.find({ boardId, period })
    .sort({ startDate: -1, 'calculated.performanceScore': -1 })
    .limit(100)
    .populate('memberId');
};

// Get underperformers
performanceSchema.statics.getUnderperformers = function(boardId, period = 'weekly') {
  return this.find({
    boardId,
    period,
    'flags.type': 'underperforming'
  })
    .sort({ 'calculated.performanceScore': 1 })
    .populate('memberId');
};

// Get high performers
performanceSchema.statics.getHighPerformers = function(boardId, period = 'weekly') {
  return this.find({
    boardId,
    period,
    'flags.type': 'high_performer'
  })
    .sort({ 'calculated.performanceScore': -1 })
    .populate('memberId');
};

// Get members needing support
performanceSchema.statics.getNeedingSupport = function(boardId) {
  return this.find({
    boardId,
    period: 'weekly',
    'flags.type': { $in: ['needs_support', 'overloaded', 'non_responsive'] }
  })
    .sort({ 'flags.severity': -1 })
    .populate('memberId');
};

// Instance methods

// Calculate all metrics
performanceSchema.methods.calculate = function() {
  // Completion rate
  if (this.metrics.cardsAssigned > 0) {
    this.calculated.completionRate = (this.metrics.cardsCompleted / this.metrics.cardsAssigned * 100).toFixed(1);
  }

  // On-time delivery rate
  if (this.metrics.cardsCompleted > 0) {
    this.calculated.onTimeDeliveryRate = (this.metrics.cardsOnTime / this.metrics.cardsCompleted * 100).toFixed(1);
  }

  // Response rate
  if (this.metrics.interventionsReceived > 0) {
    this.calculated.responseRate = (this.metrics.interventionsResponded / this.metrics.interventionsReceived * 100).toFixed(1);
  }

  // Workload level
  if (this.metrics.cardsAssigned <= 5) {
    this.calculated.workloadLevel = 'light';
  } else if (this.metrics.cardsAssigned <= 10) {
    this.calculated.workloadLevel = 'normal';
  } else if (this.metrics.cardsAssigned <= 15) {
    this.calculated.workloadLevel = 'heavy';
  } else {
    this.calculated.workloadLevel = 'overloaded';
  }

  // Performance score (0-100)
  const completionWeight = 0.3;
  const onTimeWeight = 0.3;
  const responseWeight = 0.2;
  const cycleTimeWeight = 0.2;

  const completionScore = parseFloat(this.calculated.completionRate) || 0;
  const onTimeScore = parseFloat(this.calculated.onTimeDeliveryRate) || 0;
  const responseScore = parseFloat(this.calculated.responseRate) || 0;
  
  // Cycle time score (inverse - lower is better)
  const avgCycleTime = this.metrics.averageCycleTime || 0;
  const teamAvgCycleTime = this.comparison.teamAverage?.cycleTime || avgCycleTime;
  const cycleTimeScore = teamAvgCycleTime > 0 
    ? Math.max(0, 100 - ((avgCycleTime / teamAvgCycleTime - 1) * 100))
    : 100;

  this.calculated.performanceScore = (
    completionScore * completionWeight +
    onTimeScore * onTimeWeight +
    responseScore * responseWeight +
    cycleTimeScore * cycleTimeWeight
  ).toFixed(1);

  // Performance grade
  const score = parseFloat(this.calculated.performanceScore);
  if (score >= 90) this.calculated.performanceGrade = 'A';
  else if (score >= 80) this.calculated.performanceGrade = 'B';
  else if (score >= 70) this.calculated.performanceGrade = 'C';
  else if (score >= 60) this.calculated.performanceGrade = 'D';
  else this.calculated.performanceGrade = 'F';

  return this;
};

// Add performance flag
performanceSchema.methods.addFlag = function(type, severity, description) {
  this.flags.push({
    type,
    severity,
    description,
    flaggedAt: new Date()
  });
  return this;
};

// Check and add automatic flags
performanceSchema.methods.checkAndAddFlags = function() {
  this.flags = []; // Reset flags

  // Underperforming
  if (parseFloat(this.calculated.performanceScore) < 60) {
    this.addFlag(
      'underperforming',
      'high',
      `Performance score ${this.calculated.performanceScore} is below acceptable threshold (60)`
    );
  }

  // Overloaded
  if (this.calculated.workloadLevel === 'overloaded') {
    this.addFlag(
      'overloaded',
      'medium',
      `Assigned ${this.metrics.cardsAssigned} cards (team avg: ${this.comparison.teamAverage?.cardsCompleted || 'N/A'})`
    );
  }

  // Non-responsive
  if (parseFloat(this.calculated.responseRate) < 50) {
    this.addFlag(
      'non_responsive',
      'high',
      `Response rate ${this.calculated.responseRate}% is below 50%`
    );
  }

  // Consistently late
  if (parseFloat(this.calculated.onTimeDeliveryRate) < 70) {
    this.addFlag(
      'consistently_late',
      'medium',
      `On-time delivery rate ${this.calculated.onTimeDeliveryRate}% is below 70%`
    );
  }

  // High performer
  if (parseFloat(this.calculated.performanceScore) >= 90) {
    this.addFlag(
      'high_performer',
      'low',
      `Exceptional performance with score of ${this.calculated.performanceScore}`
    );
  }

  // Needs support
  if (this.metrics.escalationsReceived > 2) {
    this.addFlag(
      'needs_support',
      'high',
      `Received ${this.metrics.escalationsReceived} escalations this period`
    );
  }

  return this;
};

// Generate performance summary
performanceSchema.methods.generateSummary = function() {
  return {
    member: this.memberId,
    period: this.period,
    dates: {
      start: this.startDate,
      end: this.endDate
    },
    overview: {
      cardsCompleted: this.metrics.cardsCompleted,
      completionRate: `${this.calculated.completionRate}%`,
      onTimeDeliveryRate: `${this.calculated.onTimeDeliveryRate}%`,
      averageCycleTime: `${this.metrics.averageCycleTime.toFixed(1)} days`,
      responseRate: `${this.calculated.responseRate}%`
    },
    assessment: {
      performanceScore: this.calculated.performanceScore,
      performanceGrade: this.calculated.performanceGrade,
      workloadLevel: this.calculated.workloadLevel,
      percentile: `${this.comparison.percentile}th percentile`,
      rank: `${this.comparison.rank} of ${this.comparison.totalMembers}`
    },
    flags: this.flags.map(f => ({
      type: f.type,
      severity: f.severity,
      description: f.description
    })),
    comparison: {
      teamAverage: this.comparison.teamAverage,
      vsTeamAverage: {
        cardsCompleted: this.comparison.teamAverage?.cardsCompleted 
          ? `${(this.metrics.cardsCompleted / this.comparison.teamAverage.cardsCompleted * 100 - 100).toFixed(1)}%`
          : 'N/A',
        cycleTime: this.comparison.teamAverage?.cycleTime
          ? `${(this.metrics.averageCycleTime / this.comparison.teamAverage.cycleTime * 100 - 100).toFixed(1)}%`
          : 'N/A'
      }
    }
  };
};

const Performance = mongoose.model('Performance', performanceSchema);

module.exports = Performance;
