const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const analyticsService = require('../services/analyticsService');
const operationsLedgerService = require('../services/operationsLedgerService');
const Analytics = require('../models/Analytics');
const { getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');
const {
  clampInteger,
  requirePermission,
  validateObjectIdParam
} = require('../utils/requestSecurity');

router.param('boardId', validateObjectIdParam('boardId'));

router.get('/recommendation-feedback', requirePermission('audit:read'), async (req, res) => {
  try {
    const summary = await operationsLedgerService.getRecommendationLearningSummary({
      workspaceId: getRequestWorkspaceObjectId(req),
      limit: clampInteger(req.query.limit, 100, 1, 250)
    });
    res.json({ success: true, summary });
  } catch (error) {
    logger.error('Failed to get recommendation learning feedback:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to retrieve recommendation learning feedback'
    });
  }
});

// Get latest analytics for a board
router.get('/board/:boardId/latest', requirePermission('audit:read'), async (req, res) => {
  try {
    const analytics = await analyticsService.getLatestAnalytics(req.params.boardId, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    
    if (!analytics) {
      return res.status(404).json({
        success: false,
        error: 'Analytics not found'
      });
    }
    
    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    logger.error('Failed to get latest analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve analytics'
    });
  }
});

// Get analytics history for a board
router.get('/board/:boardId/history', requirePermission('audit:read'), async (req, res) => {
  try {
    const days = clampInteger(req.query.days, 30, 1, 365);
    const history = await analyticsService.getAnalyticsHistory(req.params.boardId, days, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    
    res.json({
      success: true,
      count: history.length,
      history
    });
  } catch (error) {
    logger.error('Failed to get analytics history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve analytics history'
    });
  }
});

// Generate analytics for a board
router.post('/board/:boardId/generate', requirePermission('analysis:run'), async (req, res) => {
  try {
    const analytics = await analyticsService.generateBoardAnalytics(req.params.boardId, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    
    if (!analytics) {
      return res.status(404).json({
        success: false,
        error: 'Board not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Analytics generated successfully',
      analytics
    });
  } catch (error) {
    logger.error('Failed to generate analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate analytics'
    });
  }
});

// Get critical boards
router.get('/critical', requirePermission('audit:read'), async (req, res) => {
  try {
    const criticalBoards = await Analytics.getCriticalBoards(getRequestWorkspaceObjectId(req));
    
    res.json({
      success: true,
      count: criticalBoards.length,
      boards: criticalBoards
    });
  } catch (error) {
    logger.error('Failed to get critical boards:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve critical boards'
    });
  }
});

// Get bottlenecks for a board
router.get('/board/:boardId/bottlenecks', requirePermission('audit:read'), async (req, res) => {
  try {
    const analytics = await analyticsService.getLatestAnalytics(req.params.boardId, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    
    if (!analytics) {
      return res.status(404).json({
        success: false,
        error: 'Analytics not found'
      });
    }
    
    res.json({
      success: true,
      bottlenecks: analytics.bottlenecks || []
    });
  } catch (error) {
    logger.error('Failed to get bottlenecks:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve bottlenecks'
    });
  }
});

// Get project health for a board
router.get('/board/:boardId/health', requirePermission('audit:read'), async (req, res) => {
  try {
    const analytics = await analyticsService.getLatestAnalytics(req.params.boardId, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    
    if (!analytics) {
      return res.status(404).json({
        success: false,
        error: 'Analytics not found'
      });
    }
    
    res.json({
      success: true,
      health: analytics.projectHealth || {}
    });
  } catch (error) {
    logger.error('Failed to get project health:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve project health'
    });
  }
});

// Get velocity metrics for a board
router.get('/board/:boardId/velocity', requirePermission('audit:read'), async (req, res) => {
  try {
    const analytics = await analyticsService.getLatestAnalytics(req.params.boardId, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    
    if (!analytics) {
      return res.status(404).json({
        success: false,
        error: 'Analytics not found'
      });
    }
    
    res.json({
      success: true,
      velocity: analytics.velocity || {}
    });
  } catch (error) {
    logger.error('Failed to get velocity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve velocity'
    });
  }
});

module.exports = router;
