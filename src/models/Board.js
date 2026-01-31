const mongoose = require('mongoose');

const boardSchema = new mongoose.Schema({
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
  url: {
    type: String,
    required: true
  },
  closed: {
    type: Boolean,
    default: false
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member'
  }],
  lists: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'List'
  }],
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
boardSchema.index({ trelloId: 1 });
boardSchema.index({ closed: 1 });
boardSchema.index({ lastSync: 1 });

// Virtual for getting active lists
boardSchema.virtual('activeLists', {
  ref: 'List',
  localField: '_id',
  foreignField: 'boardId',
  match: { closed: false }
});

// Virtual for getting active cards
boardSchema.virtual('activeCards', {
  ref: 'Card',
  localField: '_id',
  foreignField: 'boardId',
  match: { closed: false }
});

// Method to check if board needs sync
boardSchema.methods.needsSync = function(intervalMinutes = 15) {
  const now = new Date();
  const lastSync = this.lastSync || new Date(0);
  const diffMinutes = (now - lastSync) / (1000 * 60);
  return diffMinutes >= intervalMinutes;
};

// Static method to find boards needing sync
boardSchema.statics.findNeedingSync = function(intervalMinutes = 15) {
  const cutoffTime = new Date(Date.now() - intervalMinutes * 60 * 1000);
  return this.find({
    closed: false,
    $or: [
      { lastSync: { $lt: cutoffTime } },
      { lastSync: { $exists: false } }
    ]
  });
};

const Board = mongoose.model('Board', boardSchema);

module.exports = Board;
