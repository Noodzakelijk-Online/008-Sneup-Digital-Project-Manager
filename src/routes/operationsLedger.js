const express = require('express');
const logger = require('../utils/logger');
const operationsLedgerService = require('../services/operationsLedgerService');
const { getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');
const { clampInteger, requirePermission } = require('../utils/requestSecurity');
const { getDemoOperationsLedger, isDemoMode } = require('../services/demoWorkspaceService');

const router = express.Router();

router.get('/', requirePermission('audit:read'), async (req, res) => {
  try {
    if (isDemoMode()) {
      return res.json({ success: true, ledger: getDemoOperationsLedger() });
    }
    const ledger = await operationsLedgerService.getWorkspaceLedger({
      workspaceId: getRequestWorkspaceObjectId(req),
      limit: clampInteger(req.query.limit, 50, 1, 250),
      healthLimit: clampInteger(req.query.healthLimit, 20, 1, 100),
      notificationLimit: clampInteger(req.query.notificationLimit, 100, 1, 250),
      days: clampInteger(req.query.days, 30, 7, 90)
    });
    res.json({ success: true, ledger });
  } catch (error) {
    logger.error('Failed to load workspace operations ledger:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to load workspace operations ledger'
    });
  }
});

module.exports = router;
