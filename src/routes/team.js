const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const teamManager = require('../services/teamManager');
const contextAnalyzer = require('../services/contextAnalyzer');

// Get workload analysis for a board
router.get('/board/:boardId/workload', async (req, res) => {
  try {
    const analysis = await teamManager.analyzeTeamWorkload(req.params.boardId);
    
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
    const suggestions = await teamManager.autoAssignCards(req.params.boardId);
    
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
    const analysis = await teamManager.identifyAtRiskCards(req.params.boardId);
    
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
    const report = await teamManager.generateTeamReport(req.params.boardId);
    
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
router.post('/recommendation/execute', async (req, res) => {
  try {
    const { recommendation } = req.body;
    
    if (!recommendation) {
      return res.status(400).json({
        success: false,
        error: 'Recommendation data required'
      });
    }
    
    const result = await teamManager.executeRecommendation(recommendation);
    
    res.json({
      success: result.success,
      message: result.success ? 'Recommendation executed successfully' : 'Failed to execute recommendation',
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
    const patterns = await contextAnalyzer.analyzeTeamPatterns();
    
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
