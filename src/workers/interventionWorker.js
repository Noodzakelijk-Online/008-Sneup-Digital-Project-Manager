const schedule = require('node-schedule');
const logger = require('../utils/logger');
const interventionEngine = require('../services/interventionEngine');
const Board = require('../models/Board');
const jobObservabilityService = require('../services/jobObservabilityService');
const { defaultWorkspaceQuery, getDefaultWorkspaceObjectId } = require('../services/workspaceScopeService');

class InterventionWorker {
  constructor() {
    this.jobs = {};
  }

  // Initialize intervention jobs
  init() {
    logger.info('Initializing intervention worker...');

    // Process interventions every 30 minutes
    this.jobs.processInterventions = schedule.scheduleJob(
      process.env.INTERVENTION_CRON || '*/30 * * * *',
      async () => {
        await jobObservabilityService.trackJob({
          jobName: 'interventions.process_all',
          jobType: 'intervention',
          triggerType: 'scheduled'
        }, () => this.processAllInterventions());
      }
    );

    // Process follow-ups every hour
    this.jobs.processFollowUps = schedule.scheduleJob(
      process.env.FOLLOWUP_CRON || '0 * * * *',
      async () => {
        await jobObservabilityService.trackJob({
          jobName: 'interventions.follow_ups',
          jobType: 'intervention',
          triggerType: 'scheduled'
        }, () => this.processFollowUps());
      }
    );

    // Process escalations every 2 hours
    this.jobs.processEscalations = schedule.scheduleJob(
      process.env.ESCALATION_CRON || '0 */2 * * *',
      async () => {
        await jobObservabilityService.trackJob({
          jobName: 'interventions.escalations',
          jobType: 'intervention',
          triggerType: 'scheduled'
        }, () => this.processEscalations());
      }
    );

    logger.info('Intervention worker initialized');
  }

  // Process interventions for all boards
  async processAllInterventions() {
    try {
      logger.info('Processing interventions for all boards...');

      const workspaceId = getDefaultWorkspaceObjectId();
      const boards = await Board.find(defaultWorkspaceQuery({ closed: false }));
      let successCount = 0;
      let failureCount = 0;

      for (const board of boards) {
        try {
          await interventionEngine.processInterventions(board._id, { workspaceId });
          successCount += 1;
        } catch (error) {
          failureCount += 1;
          logger.error(`Failed to process interventions for board ${board._id}:`, error);
        }
      }

      logger.info(`Processed interventions for ${boards.length} boards`);
      return {
        processedCount: boards.length,
        successCount,
        failureCount
      };
    } catch (error) {
      logger.error('Failed to process all interventions:', error);
      throw error;
    }
  }

  // Process follow-ups
  async processFollowUps() {
    try {
      logger.info('Processing follow-ups...');
      await interventionEngine.processFollowUps();
      return {
        processedCount: 1,
        successCount: 1,
        failureCount: 0
      };
    } catch (error) {
      logger.error('Failed to process follow-ups:', error);
      throw error;
    }
  }

  // Process escalations
  async processEscalations() {
    try {
      logger.info('Processing escalations...');
      await interventionEngine.processEscalations();
      return {
        processedCount: 1,
        successCount: 1,
        failureCount: 0
      };
    } catch (error) {
      logger.error('Failed to process escalations:', error);
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
    logger.info('Intervention worker stopped');
  }
}

module.exports = new InterventionWorker();
