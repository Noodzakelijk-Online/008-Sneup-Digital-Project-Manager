const schedule = require('node-schedule');
const logger = require('../utils/logger');
const workspaceInviteService = require('../services/workspaceInviteService');
const jobObservabilityService = require('../services/jobObservabilityService');

class IdentityRetentionWorker {
  constructor() {
    this.job = null;
    this.activeRun = null;
  }

  init() {
    if (this.job) return this.job;
    this.job = schedule.scheduleJob(
      process.env.SNEUP_INVITE_RETENTION_CRON || '15 3 * * *',
      () => this.runScheduledRetention()
    );
    logger.info('Identity retention worker initialized');
    return this.job;
  }

  async runScheduledRetention() {
    if (this.activeRun) {
      logger.warn('Skipping overlapping invitation retention run');
      return { skipped: true, reason: 'retention_in_progress' };
    }
    const run = this.runRetentionPass();
    this.activeRun = run;
    try {
      return await run;
    } finally {
      this.activeRun = null;
    }
  }

  async runRetentionPass() {
    const workspaceIds = await workspaceInviteService.listRetainableWorkspaceIds();
    const results = [];
    for (const workspaceId of workspaceIds) {
      results.push(await jobObservabilityService.trackJob({
        jobName: 'identity.invitation_retention',
        jobType: 'security',
        triggerType: 'scheduled',
        workspaceId
      }, () => workspaceInviteService.redactRetainedInvites({ workspaceId })));
    }
    return results;
  }

  stop() {
    this.job?.cancel();
    this.job = null;
    this.activeRun = null;
    logger.info('Identity retention worker stopped');
  }
}

module.exports = new IdentityRetentionWorker();
