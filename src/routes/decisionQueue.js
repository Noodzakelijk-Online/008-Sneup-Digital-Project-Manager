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

router.param('itemId', validateObjectIdParam('itemId'));

const workspaceOptions = (req) => ({
  workspaceId: getRequestWorkspaceObjectId(req)
});

const actorBody = (req, actorField) => ({
  ...req.body,
  ...workspaceOptions(req),
  [actorField]: req.body[actorField] || req.auth?.actorId
});

const sendError = (res, error, fallback) => res.status(error.statusCode || 500).json({
  success: false,
  error: error.statusCode ? error.message : fallback
});

const listQueue = async (req, res, ownerType) => {
  try {
    const items = await operationsLedgerService.listDecisionQueue({
      ...workspaceOptions(req),
      ownerType: ownerType || req.query.ownerType,
      status: req.query.status || 'open',
      boardId: req.query.boardId,
      limit: clampInteger(req.query.limit, 100, 1, 250)
    });

    res.json({ success: true, count: items.length, items });
  } catch (error) {
    logger.error('Failed to list decision queue:', error);
    sendError(res, error, 'Failed to list decision queue');
  }
};

router.get('/', requirePermission('decision-queue:manage'), (req, res) => listQueue(req, res));
router.get('/robert', requirePermission('decision-queue:manage'), (req, res) => listQueue(req, res, 'robert'));
router.get('/team', requirePermission('decision-queue:manage'), (req, res) => listQueue(req, res, 'team'));
router.get('/va', requirePermission('decision-queue:manage'), (req, res) => listQueue(req, res, 'va'));

router.post('/:itemId/resolve', requirePermission('decision-queue:manage'), async (req, res) => {
  try {
    const item = await operationsLedgerService.resolveDecisionQueueItem(req.params.itemId, actorBody(req, 'resolvedBy'));
    res.json({ success: true, item });
  } catch (error) {
    logger.error('Failed to resolve decision queue item:', error);
    sendError(res, error, 'Failed to resolve decision queue item');
  }
});

router.post('/:itemId/snooze', requirePermission('decision-queue:manage'), async (req, res) => {
  try {
    const item = await operationsLedgerService.snoozeDecisionQueueItem(req.params.itemId, actorBody(req, 'snoozedBy'));
    res.json({ success: true, item });
  } catch (error) {
    logger.error('Failed to snooze decision queue item:', error);
    sendError(res, error, 'Failed to snooze decision queue item');
  }
});

router.post('/:itemId/delegate', requirePermission('decision-queue:manage'), async (req, res) => {
  try {
    const item = await operationsLedgerService.delegateDecisionQueueItem(req.params.itemId, actorBody(req, 'delegatedBy'));
    res.json({ success: true, item });
  } catch (error) {
    logger.error('Failed to delegate decision queue item:', error);
    sendError(res, error, 'Failed to delegate decision queue item');
  }
});

module.exports = router;
