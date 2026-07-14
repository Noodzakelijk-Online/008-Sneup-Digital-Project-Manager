const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const operationsLedgerService = require('../services/operationsLedgerService');
const { getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');
const {
  clampInteger,
  requirePermission,
  validateObjectIdParam
} = require('../utils/requestSecurity');

router.param('recommendationId', validateObjectIdParam('recommendationId'));

const workspaceOptions = (req) => ({
  workspaceId: getRequestWorkspaceObjectId(req)
});

const sendError = (res, error, fallback) => res.status(error.statusCode || 500).json({
  success: false,
  error: error.statusCode ? error.message : fallback
});

router.get('/', requirePermission('audit:read'), async (req, res) => {
  try {
    const outcomes = await operationsLedgerService.listInterventionOutcomes({
      ...workspaceOptions(req),
      status: req.query.status,
      boardId: req.query.boardId,
      cardId: req.query.cardId,
      recommendationId: req.query.recommendationId,
      limit: clampInteger(req.query.limit, 100, 1, 250)
    });
    res.json({ success: true, count: outcomes.length, outcomes });
  } catch (error) {
    logger.error('Failed to list intervention outcomes:', error);
    sendError(res, error, 'Failed to list intervention outcomes');
  }
});

router.get('/recommendations/:recommendationId', requirePermission('audit:read'), async (req, res) => {
  try {
    const outcomes = await operationsLedgerService.listInterventionOutcomes({
      ...workspaceOptions(req),
      recommendationId: req.params.recommendationId,
      limit: clampInteger(req.query.limit, 50, 1, 100)
    });
    res.json({ success: true, count: outcomes.length, outcomes });
  } catch (error) {
    logger.error('Failed to list recommendation outcomes:', error);
    sendError(res, error, 'Failed to list recommendation outcomes');
  }
});

router.post('/recommendations/:recommendationId/evaluate', requirePermission('trello-actions:reconcile'), async (req, res) => {
  try {
    const outcome = await operationsLedgerService.evaluateRecommendationOutcome(req.params.recommendationId, {
      ...workspaceOptions(req),
      evaluatedBy: req.body.evaluatedBy || req.auth?.actorId
    });
    res.json({ success: true, outcome });
  } catch (error) {
    logger.error('Failed to evaluate intervention outcome:', error);
    sendError(res, error, 'Failed to evaluate intervention outcome');
  }
});

module.exports = router;
