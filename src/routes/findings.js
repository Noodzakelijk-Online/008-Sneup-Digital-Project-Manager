const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const CardFinding = require('../models/CardFinding');
const BoardHealthSnapshot = require('../models/BoardHealthSnapshot');
const operationsLedgerService = require('../services/operationsLedgerService');
const { scopeQuery } = require('../services/workspaceScopeService');
const { clampInteger } = require('../utils/requestSecurity');

const sendError = (res, error, fallback) => res.status(error.statusCode || 500).json({
  success: false,
  error: error.statusCode ? error.message : fallback
});

router.get('/', async (req, res) => {
  try {
    operationsLedgerService.requireDatabase();
    const query = scopeQuery(req);
    if (req.query.boardId) query.boardId = req.query.boardId;
    if (req.query.cardId) query.cardId = req.query.cardId;
    if (req.query.status) query.status = req.query.status;
    if (req.query.severity) query.severity = req.query.severity;
    if (req.query.waitingOn) query.waitingOn = req.query.waitingOn;
    if (req.query.findingType) query.findingType = req.query.findingType;

    const findings = await CardFinding.find(query)
      .sort({ severity: -1, signalScore: -1, lastObservedAt: -1 })
      .populate('boardId cardId memberId')
      .limit(clampInteger(req.query.limit, 100, 1, 250));

    res.json({ success: true, count: findings.length, findings });
  } catch (error) {
    logger.error('Failed to list card findings:', error);
    sendError(res, error, 'Failed to list card findings');
  }
});

router.get('/board-health', async (req, res) => {
  try {
    operationsLedgerService.requireDatabase();
    const query = scopeQuery(req);
    if (req.query.boardId) query.boardId = req.query.boardId;
    if (req.query.healthStatus) query.healthStatus = req.query.healthStatus;

    const snapshots = await BoardHealthSnapshot.find(query)
      .sort({ generatedAt: -1 })
      .populate('boardId')
      .limit(clampInteger(req.query.limit, 50, 1, 100));

    res.json({ success: true, count: snapshots.length, snapshots });
  } catch (error) {
    logger.error('Failed to list board health snapshots:', error);
    sendError(res, error, 'Failed to list board health snapshots');
  }
});

module.exports = router;