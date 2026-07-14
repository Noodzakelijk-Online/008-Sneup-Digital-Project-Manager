const schedule = require('node-schedule');
const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');
const jobObservabilityService = require('../services/jobObservabilityService');

class NotificationWorker {
  constructor() {
    this.jobs = {};
  }

  init() {
    if (this.jobs.reconciliationAlerts) return;

    this.jobs.reconciliationAlerts = schedule.scheduleJob(
      process.env.SNEUP_NOTIFICATION_CRON || '*/15 * * * *',
      async () => {
        await jobObservabilityService.trackJob({
          jobName: 'notifications.reconciliation_alerts',
          jobType: 'system',
          triggerType: 'scheduled'
        }, () => notificationService.dispatchAllReconciliationAlerts());
      }
    );

    logger.info('Notification worker initialized');
  }

  stop() {
    Object.values(this.jobs).forEach(job => job?.cancel());
    this.jobs = {};
    logger.info('Notification worker stopped');
  }
}

module.exports = new NotificationWorker();
