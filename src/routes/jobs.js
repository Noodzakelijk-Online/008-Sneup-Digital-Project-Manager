const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const jobObservabilityService = require('../services/jobObservabilityService');
const { clampInteger } = require('../utils/requestSecurity');

router.get('/', async (req, res) => {
  try {
    const dashboard = await jobObservabilityService.getDashboard({
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

module.exports = router;
