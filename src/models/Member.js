const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  trelloId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  username: {
    type: String,
    required: true,
    index: true
  },
  fullName: {
    type: String,
    required: true
  },
  email: {
    type: String
  },
  avatarUrl: {
    type: String
  },
  boards: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board'
  }],
  assignedCards: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Card'
  }],
  completedCards: {
    last7Days: {
      type: Number,
      default: 0
    },
    last30Days: {
      type: Number,
      default: 0
    },
    total: {
      type: Number,
      default: 0
    }
  },
  averageCompletionTime: {
    type: Number, // in hours
    default: 0
  },
  workloadLevel: {
    type: String,
    enum: ['light', 'normal', 'heavy', 'overloaded'],
    default: 'normal',
    index: true
  },
  specialties: [{
    type: String
  }],
  communicationStyle: {
    formality: {
      type: String,
      enum: ['very_casual', 'casual', 'formal', 'very_formal'],
      default: 'casual'
    },
    averageCommentLength: {
      type: Number,
      default: 0
    },
    sentimentAverage: {
      type: Number,
      default: 0
    }
  },
  lastSync: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
memberSchema.index({ trelloId: 1 });
memberSchema.index({ username: 1 });
memberSchema.index({ workloadLevel: 1 });
memberSchema.index({ boards: 1 });

// Virtual for active assigned cards
memberSchema.virtual('activeAssignedCards', {
  ref: 'Card',
  localField: '_id',
  foreignField: 'members',
  match: { closed: false }
});

// Method to calculate current workload
memberSchema.methods.calculateWorkload = async function() {
  const Card = mongoose.model('Card');
  
  // Count active assigned cards
  const assignedCount = await Card.countDocuments({
    members: this._id,
    closed: false
  });
  
  // Simple workload calculation (can be enhanced)
  // Assuming 5 cards is optimal workload
  const optimalWorkload = 5;
  const workloadRatio = assignedCount / optimalWorkload;
  
  let workloadLevel = 'normal';
  if (workloadRatio >= 1.2) {
    workloadLevel = 'overloaded';
  } else if (workloadRatio >= 0.9) {
    workloadLevel = 'heavy';
  } else if (workloadRatio <= 0.3) {
    workloadLevel = 'light';
  }
  
  this.workloadLevel = workloadLevel;
  await this.save();
  
  return { assignedCount, workloadRatio, workloadLevel };
};

// Method to check if member is available for new tasks
memberSchema.methods.isAvailable = function() {
  return this.workloadLevel === 'light' || this.workloadLevel === 'normal';
};

// Method to check if member is overloaded
memberSchema.methods.isOverloaded = function() {
  return this.workloadLevel === 'overloaded';
};

// Static method to find available members
memberSchema.statics.findAvailable = function() {
  return this.find({
    workloadLevel: { $in: ['light', 'normal'] }
  });
};

// Static method to find overloaded members
memberSchema.statics.findOverloaded = function() {
  return this.find({
    workloadLevel: 'overloaded'
  });
};

// Static method to find members by specialty
memberSchema.statics.findBySpecialty = function(specialty) {
  return this.find({
    specialties: specialty
  });
};

const Member = mongoose.model('Member', memberSchema);

module.exports = Member;
