const mongoose = require('mongoose');

const listSchema = new mongoose.Schema({
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
  boardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    required: true,
    index: true
  },
  position: {
    type: Number,
    default: 0
  },
  closed: {
    type: Boolean,
    default: false
  },
  cards: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Card'
  }],
  cardCount: {
    type: Number,
    default: 0
  },
  averageTimeInList: {
    type: Number, // in hours
    default: 0
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
listSchema.index({ trelloId: 1 });
listSchema.index({ boardId: 1, position: 1 });
listSchema.index({ closed: 1 });

// Virtual for getting active cards
listSchema.virtual('activeCards', {
  ref: 'Card',
  localField: '_id',
  foreignField: 'listId',
  match: { closed: false }
});

// Method to check if this is a "done" list
listSchema.methods.isDoneList = function() {
  const nameLower = this.name.toLowerCase();
  const doneKeywords = ['done', 'complete', 'finished', 'closed', 'archive'];
  return doneKeywords.some(keyword => nameLower.includes(keyword));
};

// Method to check if this is a bottleneck
listSchema.methods.isBottleneck = function(averageCycleTime, totalLists) {
  if (!averageCycleTime || !totalLists || totalLists === 0) {
    return { isBottleneck: false, severity: 'none' };
  }
  
  const expectedTimePerList = averageCycleTime / totalLists;
  const multiplier = this.averageTimeInList / expectedTimePerList;
  
  if (multiplier > 3) {
    return { isBottleneck: true, severity: 'high' };
  } else if (multiplier > 2) {
    return { isBottleneck: true, severity: 'medium' };
  }
  
  return { isBottleneck: false, severity: 'none' };
};

const List = mongoose.model('List', listSchema);

module.exports = List;
