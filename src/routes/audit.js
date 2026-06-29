const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const operationsLedgerService = require('../services/operationsLedgerService');
const { getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');
const { clampInteger } = require('../utils/requestSecurity');

router.get('/', async (req, res) => {
  try {
    const auditEvents = await operationsLedgerService.listAuditEvents({
      workspaceId: getRequestWorkspaceObjectId(req),
      entityType: req.query.entityType,
      entityId: req.query.entityId,
      action: req.query.action,
      boardId: req.query.boardId,
      cardId: req.query.cardId,
      limit: clampInteger(req.query.limit, 100, 1, 250)
    });

    res.json({ success: true, count: auditEvents.length, auditEvents });
  } catch (error) {
    logger.error('Failed to list audit events:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to list audit events'
    });
  }
});

module.exports = router;