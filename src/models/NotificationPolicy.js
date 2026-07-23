const mongoose = require('mongoose');

const notificationPolicySchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  channel: {
    type: String,
    enum: ['slack_webhook', 'teams_webhook', 'generic_webhook', 'email'],
    required: true
  },
  destinationEncrypted: {
    type: String,
    required: true,
    select: false
  },
  destinationLabel: {
    type: String,
    trim: true,
    maxlength: 160
  },
  eventTypes: [{
    type: String,
    enum: ['reconciliation_alert', 'weekly_status_report', 'daily_operations_brief']
  }],
  minimumSeverity: {
    type: String,
    enum: ['warning', 'critical'],
    default: 'warning'
  },
  quietHours: {
    enabled: { type: Boolean, default: false },
    startHourUtc: { type: Number, min: 0, max: 23, default: 18 },
    endHourUtc: { type: Number, min: 0, max: 23, default: 8 }
  },
  digest: {
    enabled: { type: Boolean, default: false },
    hourUtc: { type: Number, min: 0, max: 23, default: 9 },
    maximumItems: { type: Number, min: 1, max: 25, default: 10 }
  },
  reportSchedule: {
    enabled: { type: Boolean, default: false },
    reportType: { type: String, enum: ['weekly_status'], default: 'weekly_status' },
    dayOfWeekUtc: { type: Number, min: 0, max: 6, default: 1 },
    hourUtc: { type: Number, min: 0, max: 23, default: 9 }
  },
  dailyBriefSchedule: {
    enabled: { type: Boolean, default: false },
    hourUtc: { type: Number, min: 0, max: 23, default: 8 }
  },
  status: {
    type: String,
    enum: ['active', 'paused'],
    default: 'paused',
    index: true
  },
  activatedBy: String,
  activatedAt: Date,
  createdBy: String,
  updatedBy: String
}, {
  timestamps: true
});

notificationPolicySchema.index({ workspaceId: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('NotificationPolicy', notificationPolicySchema);
