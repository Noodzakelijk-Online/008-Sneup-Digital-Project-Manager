const express = require('express');
const connectorSyncService = require('../services/connectorSyncService');
const workGraphService = require('../services/workGraphService');
const workSignalAdapterService = require('../services/workSignalAdapterService');
const workSignalService = require('../services/workSignalService');
const { getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');
const { requirePermission, validateObjectIdParam } = require('../utils/requestSecurity');
const logger = require('../utils/logger');

const router = express.Router();

router.param('accountId', validateObjectIdParam('accountId'));

const requestOptions = (req) => ({
  workspaceId: getRequestWorkspaceObjectId(req),
  actorId: req.auth?.actorId
});

const sendError = (res, error) => {
  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Work signal operation failed'
  });
};

router.get('/', async (req, res) => {
  try {
    const result = await workSignalService.listSignals({
      ...requestOptions(req),
      provider: req.query.provider,
      status: req.query.status,
      sourceType: req.query.sourceType,
      priority: req.query.priority,
      limit: req.query.limit
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Failed to list work signals:', error);
    sendError(res, error);
  }
});

router.get('/contracts', (req, res) => {
  try {
    const contracts = workSignalService.getAdapterContracts();
    res.json({
      success: true,
      count: contracts.length,
      contracts
    });
  } catch (error) {
    logger.error('Failed to list work signal adapter contracts:', error);
    sendError(res, error);
  }
});

router.get('/adapters', (req, res) => {
  try {
    const adapters = workSignalAdapterService.listAdapters();
    res.json({
      success: true,
      count: adapters.length,
      adapters
    });
  } catch (error) {
    logger.error('Failed to list work signal adapters:', error);
    sendError(res, error);
  }
});

router.get('/graph', async (req, res) => {
  try {
    const graph = await workGraphService.getSummary({
      ...requestOptions(req),
      limit: req.query.limit
    });
    res.json({
      success: true,
      graph
    });
  } catch (error) {
    logger.error('Failed to summarize work graph:', error);
    sendError(res, error);
  }
});

router.post('/accounts/:accountId/upsert', requirePermission('sync:run'), async (req, res) => {
  try {
    const signal = await workSignalService.upsertSignal(req.params.accountId, req.body, requestOptions(req));
    res.status(201).json({
      success: true,
      signal
    });
  } catch (error) {
    logger.error('Failed to upsert work signal:', error);
    sendError(res, error);
  }
});

router.post('/accounts/:accountId/sync', requirePermission('sync:run'), async (req, res) => {
  try {
    const result = await connectorSyncService.syncAccount(req.params.accountId, {
      ...requestOptions(req),
      actor: req.auth?.actorId || 'api'
    });
    res.json({
      success: true,
      result
    });
  } catch (error) {
    logger.error('Failed to sync connector work signals:', error);
    sendError(res, error);
  }
});

module.exports = router;
