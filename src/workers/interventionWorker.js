const schedule = require('node-schedule');
const logger = require('../utils/logger');
const interventionEngine = require('../services/interventionEngine');
const Board = require('../models/Board');

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
        await this.processAllInterventions();
      }
    );

    // Process follow-ups every hour
    this.jobs.processFollowUps = schedule.scheduleJob(
      process.env.FOLLOWUP_CRON || '0 * * * *',
      async () => {
        await this.processFollowUps();
      }
    );

    // Process escalations every 2 hours
    this.jobs.processEscalations = schedule.scheduleJob(
      process.env.ESCALATION_CRON || '0 */2 * * *',
      async () => {
        await this.processEscalations();
      }
    );

    logger.info('Intervention worker initialized');
  }

  // Process interventions for all boards
  async processAllInterventions() {
    try {
      logger.info('Processing interventions for all boards...');

      const boards = await Board.find({ active: true });

      for (const board of boards) {
        try {
          await interventionEngine.processInterventions(board._id);
        } catch (error) {
          logger.error(`Failed to process interventions for board ${board._id}:`, error);
        }
      }

      logger.info(`Processed interventions for ${boards.length} boards`);
    } catch (error) {
      logger.error('Failed to process all interventions:', error);
    }
  }

  // Process follow-ups
  async processFollowUps() {
    try {
      logger.info('Processing follow-ups...');
      await interventionEngine.processFollowUps();
    } catch (error) {
      logger.error('Failed to process follow-ups:', error);
    }
  }

  // Process escalations
  async processEscalations() {
    try {
      logger.info('Processing escalations...');
      await interventionEngine.processEscalations();
    } catch (error) {
      logger.error('Failed to process escalations:', error);
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
