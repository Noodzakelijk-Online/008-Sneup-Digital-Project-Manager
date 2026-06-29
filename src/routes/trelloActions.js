const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const operationsLedgerService = require('../services/operationsLedgerService');
const { getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');
const { clampInteger } = require('../utils/requestSecurity');

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

module.exports = router;