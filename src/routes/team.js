const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const teamManager = require('../services/teamManager');
const operationsLedgerService = require('../services/operationsLedgerService');
const contextAnalyzer = require('../services/contextAnalyzer');
const { requirePermission, validateObjectIdParam } = require('../utils/requestSecurity');
const { getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');

router.param('boardId', validateObjectIdParam('boardId'));

router.get('/accountability', requirePermission('audit:read'), async (req, res) => {
  try {
    const accountability = await operationsLedgerService.getWorkerAccountability({
      workspaceId: getRequestWorkspaceObjectId(req),
      days: req.query.days,
      limit: req.query.limit
    });
    res.json({ success: true, accountability });
  } catch (error) {
    logger.error('Failed to get worker accountability:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to retrieve worker accountability'
    });
  }
});

// Get workload analysis for a board
router.get('/board/:boardId/workload', async (req, res) => {
  try {
    const analysis = await teamManager.analyzeTeamWorkload(req.params.boardId, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    
    if (!analysis) {
      return res.status(404).json({
        success: false,
        error: 'Board not found'
      });
    }
    
    res.json({
      success: true,
      analysis
    });
  } catch (error) {
    logger.error('Failed to get workload analysis:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve workload analysis'
    });
  }
});

// Get auto-assignment suggestions
router.get('/board/:boardId/auto-assign', async (req, res) => {
  try {
    const suggestions = await teamManager.autoAssignCards(req.params.boardId, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    
    if (!suggestions) {
      return res.status(404).json({
        success: false,
        error: 'Board not found'
      });
    }
    
    res.json({
      success: true,
      suggestions
    });
  } catch (error) {
    logger.error('Failed to get auto-assignment suggestions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve suggestions'
    });
  }
});

// Get at-risk cards
router.get('/board/:boardId/at-risk', async (req, res) => {
  try {
    const analysis = await teamManager.identifyAtRiskCards(req.params.boardId, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    
    if (!analysis) {
      return res.status(404).json({
        success: false,
        error: 'Board not found'
      });
    }
    
    res.json({
      success: true,
      analysis
    });
  } catch (error) {
    logger.error('Failed to get at-risk cards:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve at-risk cards'
    });
  }
});

// Generate team report
router.get('/board/:boardId/report', async (req, res) => {
  try {
    const report = await teamManager.generateTeamReport(req.params.boardId, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    
    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Board not found'
      });
    }
    
    res.json({
      success: true,
      report
    });
  } catch (error) {
    logger.error('Failed to generate team report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate report'
    });
  }
});

// Execute a recommendation
router.post('/recommendation/execute', requirePermission('approvals:decide'), async (req, res) => {
  try {
    const { recommendation } = req.body;
    
    if (!recommendation || recommendation.type !== 'reassign') {
      return res.status(400).json({
        success: false,
        error: 'Supported recommendation data required'
      });
    }

    const requiredIds = [
      recommendation.cardId,
      recommendation.fromMember?.id,
      recommendation.toMember?.id
    ];
    if (requiredIds.some(id => !id || !/^[a-f\d]{24}$/i.test(String(id)))) {
      return res.status(400).json({
        success: false,
        error: 'Recommendation contains invalid identifiers'
      });
    }
    
    const result = await teamManager.executeRecommendation(recommendation, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    
    res.json({
      success: result.success,
      requiresApproval: result.requiresApproval || false,
      recommendationId: result.recommendationId,
      message: result.message || (result.success ? 'Recommendation queued successfully' : 'Failed to queue recommendation'),
      error: result.error
    });
  } catch (error) {
    logger.error('Failed to execute recommendation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute recommendation'
    });
  }
});

// Get team patterns
router.get('/patterns', async (req, res) => {
  try {
    const patterns = await contextAnalyzer.analyzeTeamPatterns({
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    
    res.json({
      success: true,
      count: patterns.length,
      patterns
    });
  } catch (error) {
    logger.error('Failed to get team patterns:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve team patterns'
    });
  }
});

module.exports = router;
