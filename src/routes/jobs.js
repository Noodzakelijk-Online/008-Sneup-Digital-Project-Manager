const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const Board = require('../models/Board');
const analyticsService = require('../services/analyticsService');
const connectorSyncService = require('../services/connectorSyncService');
const interventionEngine = require('../services/interventionEngine');
const jobObservabilityService = require('../services/jobObservabilityService');
const operationsLedgerService = require('../services/operationsLedgerService');
const performanceTracker = require('../services/performanceTracker');
const notificationService = require('../services/notificationService');
const trelloSync = require('../services/trelloSync');
const { defaultWorkspaceQuery, getDefaultWorkspaceObjectId, getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');
const { clampInteger, requirePermission } = require('../utils/requestSecurity');

const actorFromRequest = (req) =>
  req.auth?.displayName || req.auth?.actorId || 'sneup-operator';

const plainState = (value) => {
  if (!value) return {};
  if (typeof value.toObject === 'function') return value.toObject();
  return value;
};

const recordJobAudit = async (req, action, jobName, afterState = {}) => {
  try {
    await operationsLedgerService.recordAudit({
      workspaceId: req.auth?.workspaceId,
      entityType: 'job_control',
      entityId: jobName,
      action,
      actor: actorFromRequest(req),
      source: 'api',
      riskLevel: action === 'job_manual_triggered' ? 'medium' : 'low',
      afterState: plainState(afterState)
    });
  } catch (error) {
    logger.warn(`Failed to record ${action} audit event for ${jobName}: ${error.message}`);
  }
};

const calculateAllPerformance = async (period, options = {}) => {
  const workspaceId = options.workspaceId || getDefaultWorkspaceObjectId();
  const boards = await Board.find({ workspaceId, closed: false });
  let successCount = 0;
  let failureCount = 0;

  for (const board of boards) {
    try {
      await performanceTracker.calculateBoardPerformance(board._id, period, { workspaceId });
      successCount += 1;
    } catch (error) {
      failureCount += 1;
      logger.error(`Failed to manually calculate ${period} performance for board ${board._id}:`, error);
    }
  }

  return {
    processedCount: boards.length,
    successCount,
    failureCount,
    metadata: { period }
  };
};

const manualJobHandlers = {
  'trello.incremental_sync': {
    jobType: 'sync',
    run: ({ workspaceId }) => trelloSync.syncRecentActivity({ workspaceId })
  },
  'analytics.generate_all': {
    jobType: 'analytics',
    run: ({ workspaceId }) => analyticsService.generateAllAnalytics({ workspaceId })
  },
  'connectors.work_signals_sync': {
    jobType: 'sync',
    run: ({ workspaceId }) => connectorSyncService.syncConnectedAccounts({ workspaceId, triggerType: 'manual' })
  },
  'notifications.reconciliation_alerts': {
    jobType: 'system',
    run: ({ workspaceId }) => notificationService.dispatchReconciliationAlerts({ workspaceId })
  },
  'interventions.process_all': {
    jobType: 'intervention',
    run: async ({ workspaceId }) => {
      const boards = await Board.find({ workspaceId, closed: false });
      let successCount = 0;
      let failureCount = 0;

      for (const board of boards) {
        try {
          await interventionEngine.processInterventions(board._id, { workspaceId });
          successCount += 1;
        } catch (error) {
          failureCount += 1;
          logger.error(`Failed to manually process interventions for board ${board._id}:`, error);
        }
      }

      return {
        processedCount: boards.length,
        successCount,
        failureCount
      };
    }
  },
  'interventions.follow_ups': {
    jobType: 'intervention',
    run: async ({ workspaceId }) => {
      const ledgerResult = await operationsLedgerService.processDueFollowUps({ workspaceId });
      const queuedInterventions = await interventionEngine.processFollowUps({ workspaceId });
      return {
        processedCount: ledgerResult.markedDue + queuedInterventions.length,
        successCount: 1,
        failureCount: 0
      };
    }
  },
  'interventions.decision_queue_snoozes': {
    jobType: 'intervention',
    run: async ({ workspaceId }) => {
      const reopenedItems = await operationsLedgerService.reopenDueSnoozedDecisionQueueItems({ workspaceId });
      return {
        processedCount: reopenedItems.length,
        successCount: reopenedItems.length,
        failureCount: 0
      };
    }
  },
  'interventions.escalations': {
    jobType: 'intervention',
    run: async ({ workspaceId }) => {
      const escalatedDecisionItems = await operationsLedgerService.processDueDecisionQueueEscalations({ workspaceId });
      const queuedInterventions = await interventionEngine.processEscalations({
        workspaceId
      });
      return {
        processedCount: escalatedDecisionItems.length + queuedInterventions.length,
        successCount: 1,
        failureCount: 0
      };
    }
  },
  'performance.daily': {
    jobType: 'performance',
    run: ({ workspaceId }) => calculateAllPerformance('daily', { workspaceId })
  },
  'performance.weekly': {
    jobType: 'performance',
    run: ({ workspaceId }) => calculateAllPerformance('weekly', { workspaceId })
  },
  'performance.monthly': {
    jobType: 'performance',
    run: ({ workspaceId }) => calculateAllPerformance('monthly', { workspaceId })
  }
};

router.get('/', async (req, res) => {
  try {
    const dashboard = await jobObservabilityService.getDashboard({
      workspaceId: getRequestWorkspaceObjectId(req),
      limit: clampInteger(req.query.limit, 250, 1, 500),
      jobType: req.query.jobType,
      status: req.query.status
    });

    res.json({
      success: true,
      dashboard
    });
  } catch (error) {
    logger.error('Failed to get job dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get job dashboard'
    });
  }
});

router.get('/health', async (req, res) => {
  try {
    const dashboard = await jobObservabilityService.getDashboard({
      workspaceId: getRequestWorkspaceObjectId(req),
      limit: clampInteger(req.query.limit, 250, 1, 500)
    });

    res.json({
      success: true,
      summary: dashboard.summary,
      health: dashboard.health
    });
  } catch (error) {
    logger.error('Failed to get job health:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get job health'
    });
  }
});

router.get('/runs', async (req, res) => {
  try {
    const runs = await jobObservabilityService.listRuns({
      workspaceId: getRequestWorkspaceObjectId(req),
      limit: clampInteger(req.query.limit, 100, 1, 500),
      jobName: req.query.jobName,
      jobType: req.query.jobType,
      status: req.query.status,
      boardId: req.query.boardId
    });

    res.json({
      success: true,
      count: runs.length,
      runs: runs.map(run => jobObservabilityService.serializeRun(run))
    });
  } catch (error) {
    logger.error('Failed to list job runs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list job runs'
    });
  }
});

router.post('/:jobName/pause', requirePermission('jobs:manage'), async (req, res) => {
  try {
    const control = await jobObservabilityService.setPaused(req.params.jobName, true, {
      workspaceId: getRequestWorkspaceObjectId(req),
      actor: actorFromRequest(req),
      reason: req.body?.reason
    });
    await recordJobAudit(req, 'job_paused', req.params.jobName, control);

    res.json({
      success: true,
      control
    });
  } catch (error) {
    logger.error('Failed to pause job:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to pause job'
    });
  }
});

router.post('/:jobName/resume', requirePermission('jobs:manage'), async (req, res) => {
  try {
    const control = await jobObservabilityService.setPaused(req.params.jobName, false, {
      workspaceId: getRequestWorkspaceObjectId(req),
      actor: actorFromRequest(req)
    });
    await recordJobAudit(req, 'job_resumed', req.params.jobName, control);

    res.json({
      success: true,
      control
    });
  } catch (error) {
    logger.error('Failed to resume job:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to resume job'
    });
  }
});

router.post('/:jobName/trigger', requirePermission('jobs:manage'), async (req, res) => {
  try {
    const config = jobObservabilityService.ensureKnownJob(req.params.jobName);
    const handler = manualJobHandlers[req.params.jobName];
    if (!config.manualTriggerAllowed || !handler) {
      return res.status(400).json({
        success: false,
        error: 'This job cannot be manually triggered'
      });
    }

    const workspaceId = getRequestWorkspaceObjectId(req);
    if (await jobObservabilityService.isJobPaused(req.params.jobName, { workspaceId })) {
      return res.status(409).json({
        success: false,
        error: 'Resume this job before triggering it manually'
      });
    }

    await jobObservabilityService.markManualRun(req.params.jobName, actorFromRequest(req), { workspaceId });
    const result = await jobObservabilityService.trackJob({
      workspaceId,
      jobName: req.params.jobName,
      jobType: handler.jobType,
      triggerType: 'manual',
      metadata: {
        requestedBy: actorFromRequest(req)
      }
    }, () => handler.run({ workspaceId }));
    await recordJobAudit(req, 'job_manual_triggered', req.params.jobName, result);

    res.json({
      success: true,
      result
    });
  } catch (error) {
    logger.error('Failed to trigger job:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to trigger job'
    });
  }
});

module.exports = router;
