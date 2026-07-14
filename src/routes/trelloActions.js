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

router.param('actionAttemptId', validateObjectIdParam('actionAttemptId'));

router.get('/', async (req, res) => {
  try {
    const actions = await operationsLedgerService.listTrelloActions({
      workspaceId: getRequestWorkspaceObjectId(req),
      status: req.query.status,
      boardId: req.query.boardId,
      cardId: req.query.cardId,
      limit: clampInteger(req.query.limit, 100, 1, 250)
    });

    res.json({ success: true, count: actions.length, actions });
  } catch (error) {
    logger.error('Failed to list Trello action attempts:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to list Trello action attempts'
    });
  }
});

router.get('/reconciliation', requirePermission('audit:read'), async (req, res) => {
  try {
    const actions = await operationsLedgerService.listTrelloActionsNeedingReconciliation({
      workspaceId: getRequestWorkspaceObjectId(req),
      limit: clampInteger(req.query.limit, 50, 1, 100)
    });
    res.json({ success: true, count: actions.length, actions });
  } catch (error) {
    logger.error('Failed to list Trello action reconciliations:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to list Trello action reconciliations'
    });
  }
});

router.post('/:actionAttemptId/reconcile', requirePermission('trello-actions:reconcile'), async (req, res) => {
  try {
    const result = await operationsLedgerService.reconcileTrelloActionAttempt(req.params.actionAttemptId, {
      ...req.body,
      workspaceId: getRequestWorkspaceObjectId(req),
      reconciledBy: req.body.reconciledBy || req.auth?.actorId
    });
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Failed to reconcile Trello action attempt:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to reconcile Trello action attempt'
    });
  }
});

module.exports = router;
