const schedule = require('node-schedule');
const logger = require('../utils/logger');
const interventionEngine = require('../services/interventionEngine');
const operationsLedgerService = require('../services/operationsLedgerService');
const Board = require('../models/Board');
const jobObservabilityService = require('../services/jobObservabilityService');
const { listActiveWorkspaceIds } = require('../services/workspaceScopeService');

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
        await this.runForActiveWorkspaces('interventions.process_all', workspaceId => this.processAllInterventions(workspaceId));
      }
    );

    // Process follow-ups every hour
    this.jobs.processFollowUps = schedule.scheduleJob(
      process.env.FOLLOWUP_CRON || '0 * * * *',
      async () => {
        await this.runForActiveWorkspaces('interventions.follow_ups', workspaceId => this.processFollowUps(workspaceId));
      }
    );

    // Reopen Snoozed decisions promptly, then give their owner a fresh internal review window.
    this.jobs.processDecisionQueueSnoozes = schedule.scheduleJob(
      process.env.DECISION_QUEUE_SNOOZE_CRON || '*/15 * * * *',
      async () => {
        await this.runForActiveWorkspaces('interventions.decision_queue_snoozes', workspaceId => this.processDecisionQueueSnoozes(workspaceId));
      }
    );

    // Process escalations every 2 hours
    this.jobs.processEscalations = schedule.scheduleJob(
      process.env.ESCALATION_CRON || '0 */2 * * *',
      async () => {
        await this.runForActiveWorkspaces('interventions.escalations', workspaceId => this.processEscalations(workspaceId));
      }
    );

    // Recheck completed provider actions without creating a new provider request.
    this.jobs.processOutcomes = schedule.scheduleJob(
      process.env.OUTCOME_EVALUATION_CRON || '30 */3 * * *',
      async () => {
        await this.runForActiveWorkspaces('interventions.outcomes', workspaceId => this.processOutcomes(workspaceId));
      }
    );

    logger.info('Intervention worker initialized');
  }

  // Process interventions for all boards
  async runForActiveWorkspaces(jobName, handler) {
    const workspaceIds = await listActiveWorkspaceIds();
    for (const workspaceId of workspaceIds) {
      await jobObservabilityService.trackJob({ jobName, jobType: 'intervention', triggerType: 'scheduled', workspaceId }, () => handler(workspaceId));
    }
  }

  async processAllInterventions(workspaceId) {
    try {
      logger.info('Processing interventions for all boards...');

      const boards = await Board.find({ workspaceId, closed: false });
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
  async processFollowUps(workspaceId) {
    try {
      logger.info('Processing follow-ups...');
      const ledgerResult = await operationsLedgerService.processDueFollowUps({ workspaceId });
      const queuedInterventions = await interventionEngine.processFollowUps({ workspaceId });
      return {
        processedCount: ledgerResult.markedDue + queuedInterventions.length,
        successCount: 1,
        failureCount: 0
      };
    } catch (error) {
      logger.error('Failed to process follow-ups:', error);
      throw error;
    }
  }

  async processDecisionQueueSnoozes(workspaceId) {
    try {
      logger.info('Reopening elapsed decision queue snoozes...');
      const reopenedItems = await operationsLedgerService.reopenDueSnoozedDecisionQueueItems({ workspaceId });
      return {
        processedCount: reopenedItems.length,
        successCount: reopenedItems.length,
        failureCount: 0
      };
    } catch (error) {
      logger.error('Failed to reopen elapsed decision queue snoozes:', error);
      throw error;
    }
  }

  // Process escalations
  async processEscalations(workspaceId) {
    try {
      logger.info('Processing escalations...');
      const escalatedDecisionItems = await operationsLedgerService.processDueDecisionQueueEscalations({ workspaceId });
      const queuedInterventions = await interventionEngine.processEscalations({
        workspaceId
      });
      return {
        processedCount: escalatedDecisionItems.length + queuedInterventions.length,
        successCount: 1,
        failureCount: 0
      };
    } catch (error) {
      logger.error('Failed to process escalations:', error);
      throw error;
    }
  }

  async processOutcomes(workspaceId) {
    try {
      logger.info('Refreshing intervention outcomes...');
      const result = await operationsLedgerService.refreshDueInterventionOutcomes({ workspaceId });
      return {
        processedCount: result.evaluatedCount,
        successCount: result.evaluatedCount,
        failureCount: result.failureCount
      };
    } catch (error) {
      logger.error('Failed to refresh intervention outcomes:', error);
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
