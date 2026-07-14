const schedule = require('node-schedule');
const logger = require('../utils/logger');
const performanceTracker = require('../services/performanceTracker');
const Board = require('../models/Board');
const jobObservabilityService = require('../services/jobObservabilityService');
const { listActiveWorkspaceIds } = require('../services/workspaceScopeService');

class PerformanceWorker {
  constructor() {
    this.jobs = {};
  }

  // Initialize performance tracking jobs
  init() {
    logger.info('Initializing performance worker...');

    // Calculate daily performance at midnight
    this.jobs.dailyPerformance = schedule.scheduleJob(
      process.env.DAILY_PERFORMANCE_CRON || '0 0 * * *',
      async () => {
        await this.runForActiveWorkspaces('performance.daily', 'daily');
      }
    );

    // Calculate weekly performance every Monday at 1 AM
    this.jobs.weeklyPerformance = schedule.scheduleJob(
      process.env.WEEKLY_PERFORMANCE_CRON || '0 1 * * 1',
      async () => {
        await this.runForActiveWorkspaces('performance.weekly', 'weekly');
      }
    );

    // Calculate monthly performance on the 1st of each month at 2 AM
    this.jobs.monthlyPerformance = schedule.scheduleJob(
      process.env.MONTHLY_PERFORMANCE_CRON || '0 2 1 * *',
      async () => {
        await this.runForActiveWorkspaces('performance.monthly', 'monthly');
      }
    );

    logger.info('Performance worker initialized');
  }

  async runForActiveWorkspaces(jobName, period) {
    const workspaceIds = await listActiveWorkspaceIds();
    for (const workspaceId of workspaceIds) {
      await jobObservabilityService.trackJob({ jobName, jobType: 'performance', triggerType: 'scheduled', workspaceId }, () => this.calculateAllPerformance(period, { workspaceId }));
    }
  }

  // Calculate performance for all boards
  async calculateAllPerformance(period, options = {}) {
    try {
      logger.info(`Calculating ${period} performance for all boards...`);

      const workspaceId = options.workspaceId;
      const boards = await Board.find({ workspaceId, closed: false });
      let successCount = 0;
      let failureCount = 0;

      for (const board of boards) {
        try {
          await performanceTracker.calculateBoardPerformance(board._id, period, { workspaceId });
          successCount += 1;
        } catch (error) {
          failureCount += 1;
          logger.error(`Failed to calculate performance for board ${board._id}:`, error);
        }
      }

      logger.info(`Calculated ${period} performance for ${boards.length} boards`);
      return {
        processedCount: boards.length,
        successCount,
        failureCount,
        metadata: { period }
      };
    } catch (error) {
      logger.error(`Failed to calculate ${period} performance:`, error);
      throw error;
    }
  }

  // Stop all jobs
  stop() {
    Object.values(this.jobs).forEach(job => {
      if (job) {
        job.cancel();
      }
    });
    logger.info('Performance worker stopped');
  }
}

module.exports = new PerformanceWorker();
