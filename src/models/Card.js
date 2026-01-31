const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema({
  trelloId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  boardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    required: true,
    index: true
  },
  listId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'List',
    required: true,
    index: true
  },
  position: {
    type: Number,
    default: 0
  },
  closed: {
    type: Boolean,
    default: false,
    index: true
  },
  due: {
    type: Date,
    index: true
  },
  dueComplete: {
    type: Boolean,
    default: false
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member'
  }],
  labels: [{
    id: String,
    name: String,
    color: String
  }],
  attachments: [{
    id: String,
    name: String,
    url: String
  }],
  checklists: [{
    id: String,
    name: String,
    items: [{
      id: String,
      name: String,
      complete: Boolean
    }]
  }],
  comments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment'
  }],
  history: [{
    listId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'List'
    },
    listName: String,
    enteredAt: Date,
    exitedAt: Date
  }],
  timeInCurrentList: {
    type: Number, // in hours
    default: 0
  },
  riskLevel: {
    type: String,
    enum: ['none', 'low', 'medium', 'high', 'critical'],
    default: 'none',
    index: true
  },
  riskFactors: [{
    type: String
  }],
  estimatedCompletionDate: {
    type: Date
  },
  lastActivity: {
    type: Date,
    default: Date.now,
    index: true
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
cardSchema.index({ trelloId: 1 });
cardSchema.index({ boardId: 1, listId: 1 });
cardSchema.index({ closed: 1, due: 1 });
cardSchema.index({ members: 1, closed: 1 });
cardSchema.index({ riskLevel: 1 });
cardSchema.index({ 'labels.name': 1 });

// Virtual for completion percentage
cardSchema.virtual('completionPercentage').get(function() {
  if (!this.checklists || this.checklists.length === 0) {
    return null;
  }
  
  let totalItems = 0;
  let completedItems = 0;
  
  for (const checklist of this.checklists) {
    if (checklist.items) {
      totalItems += checklist.items.length;
      completedItems += checklist.items.filter(item => item.complete).length;
    }
  }
  
  return totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : null;
});

// Method to check if card is overdue
cardSchema.methods.isOverdue = function() {
  if (!this.due || this.dueComplete || this.closed) {
    return false;
  }
  return new Date() > new Date(this.due);
};

// Method to calculate days until due
cardSchema.methods.daysUntilDue = function() {
  if (!this.due || this.dueComplete || this.closed) {
    return null;
  }
  
  const now = new Date();
  const dueDate = new Date(this.due);
  const diffTime = dueDate - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
};

// Method to check if card is stuck
cardSchema.methods.isStuck = function(averageTimeInList) {
  if (!averageTimeInList || averageTimeInList === 0) {
    return false;
  }
  
  // Card is stuck if it's been in current list 2x longer than average
  return this.timeInCurrentList > (averageTimeInList * 2);
};

// Method to assess risk level
cardSchema.methods.assessRisk = function(averageTimeInList) {
  const riskFactors = [];
  let riskScore = 0;
  
  // Check if overdue
  if (this.isOverdue()) {
    riskFactors.push('Overdue');
    riskScore += 3;
  }
  
  // Check if due soon (within 2 days)
  const daysUntilDue = this.daysUntilDue();
  if (daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= 2) {
    riskFactors.push('Due soon');
    riskScore += 2;
  }
  
  // Check if stuck
  if (this.isStuck(averageTimeInList)) {
    riskFactors.push('Stuck in current list');
    riskScore += 2;
  }
  
  // Check if no activity recently (7 days)
  const daysSinceActivity = (Date.now() - new Date(this.lastActivity)) / (1000 * 60 * 60 * 24);
  if (daysSinceActivity > 7) {
    riskFactors.push('No recent activity');
    riskScore += 1;
  }
  
  // Check if no members assigned
  if (!this.members || this.members.length === 0) {
    riskFactors.push('No members assigned');
    riskScore += 1;
  }
  
  // Determine risk level
  let riskLevel = 'none';
  if (riskScore >= 6) {
    riskLevel = 'critical';
  } else if (riskScore >= 4) {
    riskLevel = 'high';
  } else if (riskScore >= 2) {
    riskLevel = 'medium';
  } else if (riskScore >= 1) {
    riskLevel = 'low';
  }
  
  this.riskLevel = riskLevel;
  this.riskFactors = riskFactors;
  
  return { riskLevel, riskFactors, riskScore };
};

// Static method to find overdue cards
cardSchema.statics.findOverdue = function() {
  return this.find({
    closed: false,
    dueComplete: false,
    due: { $lt: new Date() }
  }).populate('boardId listId members');
};

// Static method to find high-risk cards
cardSchema.statics.findHighRisk = function() {
  return this.find({
    closed: false,
    riskLevel: { $in: ['high', 'critical'] }
  }).populate('boardId listId members');
};

const Card = mongoose.model('Card', cardSchema);

module.exports = Card;
