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
      async () => this.runScheduledReconciliationAlerts()
    );

    logger.info('Notification worker initialized');
  }

  async runScheduledReconciliationAlerts() {
    const workspaceIds = await notificationService.listActiveReconciliationWorkspaceIds();
    const results = [];

    for (const workspaceId of workspaceIds) {
      results.push(await jobObservabilityService.trackJob({
        jobName: 'notifications.reconciliation_alerts',
        jobType: 'system',
        triggerType: 'scheduled',
        workspaceId
      }, () => notificationService.dispatchReconciliationAlerts({ workspaceId })));
    }

    return results;
  }

  stop() {
    Object.values(this.jobs).forEach(job => job?.cancel());
    this.jobs = {};
    logger.info('Notification worker stopped');
  }
}

module.exports = new NotificationWorker();
