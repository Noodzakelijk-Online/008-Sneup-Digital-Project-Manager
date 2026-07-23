const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const operationsLedgerService = require('../services/operationsLedgerService');
const { getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');
const { bodyWithAuthenticatedActor } = require('../utils/requestActor');
const {
  clampInteger,
  requirePermission,
  validateObjectIdParam
} = require('../utils/requestSecurity');

router.param('followUpId', validateObjectIdParam('followUpId'));

const workspaceOptions = (req) => ({
  workspaceId: getRequestWorkspaceObjectId(req)
});

const sendError = (res, error, fallback) => res.status(error.statusCode || 500).json({
  success: false,
  error: error.statusCode ? error.message : fallback
});

router.get('/', requirePermission('follow-ups:manage'), async (req, res) => {
  try {
    const followUps = await operationsLedgerService.listFollowUps({
      ...workspaceOptions(req),
      status: req.query.status,
      boardId: req.query.boardId,
      cardId: req.query.cardId,
      limit: clampInteger(req.query.limit, 100, 1, 250)
    });

    res.json({ success: true, count: followUps.length, followUps });
  } catch (error) {
    logger.error('Failed to list follow-ups:', error);
    sendError(res, error, 'Failed to list follow-ups');
  }
});

router.get('/due', requirePermission('follow-ups:manage'), async (req, res) => {
  try {
    const followUps = await operationsLedgerService.listFollowUps({
      ...workspaceOptions(req),
      dueOnly: true,
      boardId: req.query.boardId,
      cardId: req.query.cardId,
      limit: clampInteger(req.query.limit, 100, 1, 250)
    });

    res.json({ success: true, count: followUps.length, followUps });
  } catch (error) {
    logger.error('Failed to list due follow-ups:', error);
    sendError(res, error, 'Failed to list due follow-ups');
  }
});

router.post('/:followUpId/resolve', requirePermission('follow-ups:manage'), async (req, res) => {
  try {
    const followUp = await operationsLedgerService.resolveFollowUp(req.params.followUpId, {
      ...bodyWithAuthenticatedActor(req, 'resolvedBy'),
      ...workspaceOptions(req),
    });
    res.json({ success: true, followUp });
  } catch (error) {
    logger.error('Failed to resolve follow-up:', error);
    sendError(res, error, 'Failed to resolve follow-up');
  }
});

module.exports = router;
