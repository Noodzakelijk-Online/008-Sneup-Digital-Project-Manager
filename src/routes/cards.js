const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const operationsLedgerService = require('../services/operationsLedgerService');
const CardFinding = require('../models/CardFinding');
const { getRequestWorkspaceObjectId, scopeQuery } = require('../services/workspaceScopeService');
const { requirePermission, validateObjectIdParam } = require('../utils/requestSecurity');

router.param('cardId', validateObjectIdParam('cardId'));

const workspaceOptions = (req) => ({
  workspaceId: getRequestWorkspaceObjectId(req)
});

const getCardOperationsLedger = async (req, res) => {
  try {
    const ledger = await operationsLedgerService.getCardLedger(req.params.cardId, workspaceOptions(req));
    res.json({ success: true, ledger });
  } catch (error) {
    logger.error('Failed to get card operations ledger:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to get card operations ledger'
    });
  }
};

router.get('/:cardId/operations-ledger', requirePermission('audit:read'), getCardOperationsLedger);
router.get('/:cardId/operating-ledger', requirePermission('audit:read'), getCardOperationsLedger);

router.get('/:cardId/audit', requirePermission('audit:read'), async (req, res) => {
  try {
    const auditEvents = await operationsLedgerService.listAuditEvents({
      ...workspaceOptions(req),
      cardId: req.params.cardId,
      limit: 100
    });
    res.json({ success: true, count: auditEvents.length, auditEvents });
  } catch (error) {
    logger.error('Failed to get card audit:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to get card audit'
    });
  }
});

router.get('/:cardId/findings', async (req, res) => {
  try {
    operationsLedgerService.requireDatabase();
    const findings = await CardFinding.find(scopeQuery(req, {
      cardId: req.params.cardId,
      status: req.query.status || 'open'
    }))
      .sort({ severity: -1, signalScore: -1, lastObservedAt: -1 })
      .populate('boardId memberId')
      .limit(100);

    res.json({ success: true, count: findings.length, findings });
  } catch (error) {
    logger.error('Failed to get card findings:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to get card findings'
    });
  }
});

module.exports = router;
