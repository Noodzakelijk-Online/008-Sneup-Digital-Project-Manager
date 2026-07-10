const mongoose = require('mongoose');

const timeOffSchema = new mongoose.Schema({
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  label: { type: String, maxlength: 160 }
}, { _id: false });

const capacityProfileSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  memberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',
    required: true,
    index: true
  },
  weeklyHours: {
    type: Number,
    default: 32,
    min: 1,
    max: 80
  },
  allocationPercent: {
    type: Number,
    default: 100,
    min: 0,
    max: 100
  },
  focusHoursPerWeek: {
    type: Number,
    default: 4,
    min: 0,
    max: 80
  },
  timeOff: {
    type: [timeOffSchema],
    default: []
  },
  skills: {
    type: [String],
    default: []
  },
  active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

capacityProfileSchema.index({ workspaceId: 1, memberId: 1 }, { unique: true });
capacityProfileSchema.index({ workspaceId: 1, active: 1, updatedAt: -1 });

module.exports = mongoose.models.CapacityProfile || mongoose.model('CapacityProfile', capacityProfileSchema);
