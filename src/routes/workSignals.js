const express = require('express');
const connectorSyncService = require('../services/connectorSyncService');
const operationsLedgerService = require('../services/operationsLedgerService');
const workGraphService = require('../services/workGraphService');
const workSignalAdapterService = require('../services/workSignalAdapterService');
const workSignalService = require('../services/workSignalService');
const { getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');
const { requirePermission, validateObjectIdParam } = require('../utils/requestSecurity');
const { getAuthenticatedActor } = require('../utils/requestActor');
const logger = require('../utils/logger');

const router = express.Router();

router.param('accountId', validateObjectIdParam('accountId'));
router.param('itemId', validateObjectIdParam('itemId'));
router.param('dependencyId', validateObjectIdParam('dependencyId'));

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

router.get('/', requirePermission('audit:read'), async (req, res) => {
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

router.get('/contracts', requirePermission('api:read'), (req, res) => {
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

router.get('/adapters', requirePermission('api:read'), (req, res) => {
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

router.get('/graph', requirePermission('audit:read'), async (req, res) => {
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

router.get('/graph/decisions', requirePermission('audit:read'), async (req, res) => {
  try {
    const result = await workGraphService.listDecisionCandidates({
      ...requestOptions(req),
      limit: req.query.limit
    });
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Failed to list work graph decision candidates:', error);
    sendError(res, error);
  }
});

router.get('/graph/items/:itemId', requirePermission('audit:read'), async (req, res) => {
  try {
    const detail = await workGraphService.getItemDetail(req.params.itemId, requestOptions(req));
    if (!detail) {
      return res.status(404).json({
        success: false,
        error: 'Work graph item not found'
      });
    }

    return res.json({
      success: true,
      detail
    });
  } catch (error) {
    logger.error('Failed to get work graph item detail:', error);
    return sendError(res, error);
  }
});

router.post('/graph/items/:itemId/queue', requirePermission('autopilot:queue'), async (req, res) => {
  try {
    const result = await operationsLedgerService.createRecommendationFromWorkItem(req.params.itemId, {
      workspaceId: getRequestWorkspaceObjectId(req),
      actor: getAuthenticatedActor(req)
    });
    res.status(result.created ? 201 : 200).json({
      success: true,
      message: result.created ? 'Work graph decision queued for approval' : 'Work graph decision is already queued',
      ...result
    });
  } catch (error) {
    logger.error('Failed to queue work graph decision:', error);
    sendError(res, error);
  }
});

router.post('/graph/dependencies/:dependencyId/review', requirePermission('analysis:run'), async (req, res) => {
  try {
    const dependency = await workGraphService.reviewDependency(req.params.dependencyId, {
      ...requestOptions(req),
      action: req.body.action,
      reason: req.body.reason,
      actorId: getAuthenticatedActor(req)
    });
    res.json({
      success: true,
      message: 'Work graph dependency review recorded',
      dependency
    });
  } catch (error) {
    logger.error('Failed to review work graph dependency:', error);
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
