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

router.param('recommendationId', validateObjectIdParam('recommendationId'));

const workspaceOptions = (req) => ({
  workspaceId: getRequestWorkspaceObjectId(req)
});

const actorBody = (req, actorField = 'decidedBy') => ({
  ...bodyWithAuthenticatedActor(req, actorField),
  ...workspaceOptions(req),
});

const sendError = (res, error, fallback) => res.status(error.statusCode || 500).json({
  success: false,
  error: error.statusCode ? error.message : fallback
});

router.get('/', requirePermission('recommendations:review'), async (req, res) => {
  try {
    const recommendations = await operationsLedgerService.listRecommendations({
      ...workspaceOptions(req),
      status: req.query.status,
      boardId: req.query.boardId,
      cardId: req.query.cardId,
      ownerType: req.query.ownerType,
      limit: clampInteger(req.query.limit, 100, 1, 250)
    });

    res.json({ success: true, count: recommendations.length, recommendations });
  } catch (error) {
    logger.error('Failed to list recommendations:', error);
    sendError(res, error, 'Failed to list recommendations');
  }
});

router.get('/:recommendationId', requirePermission('recommendations:review'), async (req, res) => {
  try {
    const recommendation = await operationsLedgerService.getRecommendation(req.params.recommendationId, workspaceOptions(req));
    if (!recommendation) {
      return res.status(404).json({ success: false, error: 'Recommendation not found' });
    }

    return res.json({ success: true, recommendation });
  } catch (error) {
    logger.error('Failed to get recommendation:', error);
    return sendError(res, error, 'Failed to get recommendation');
  }
});

router.get('/:recommendationId/evidence', requirePermission('audit:read'), async (req, res) => {
  try {
    const evidence = await operationsLedgerService.getRecommendationEvidence(req.params.recommendationId, workspaceOptions(req));
    if (!evidence) {
      return res.status(404).json({ success: false, error: 'Recommendation not found' });
    }

    return res.json({ success: true, evidence });
  } catch (error) {
    logger.error('Failed to get recommendation evidence:', error);
    return sendError(res, error, 'Failed to get recommendation evidence');
  }
});

router.post('/:recommendationId/approve', requirePermission('approvals:decide'), async (req, res) => {
  try {
    const result = await operationsLedgerService.approveRecommendation(req.params.recommendationId, actorBody(req));
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Failed to approve recommendation:', error);
    sendError(res, error, 'Failed to approve recommendation');
  }
});

router.post('/:recommendationId/reject', requirePermission('approvals:decide'), async (req, res) => {
  try {
    const result = await operationsLedgerService.rejectRecommendation(req.params.recommendationId, actorBody(req));
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Failed to reject recommendation:', error);
    sendError(res, error, 'Failed to reject recommendation');
  }
});

router.post('/:recommendationId/change', requirePermission('approvals:decide'), async (req, res) => {
  try {
    const result = await operationsLedgerService.requestRecommendationChange(req.params.recommendationId, actorBody(req));
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Failed to request recommendation change:', error);
    sendError(res, error, 'Failed to request recommendation change');
  }
});

router.post('/:recommendationId/payload', requirePermission('approvals:decide'), async (req, res) => {
  try {
    const recommendation = await operationsLedgerService.updateRecommendationPayload(req.params.recommendationId, actorBody(req, 'updatedBy'));
    res.json({ success: true, recommendation });
  } catch (error) {
    logger.error('Failed to update recommendation payload:', error);
    sendError(res, error, 'Failed to update recommendation payload');
  }
});

router.post('/:recommendationId/execute-approved', requirePermission('trello-actions:execute-approved'), async (req, res) => {
  try {
    const result = await operationsLedgerService.executeApprovedRecommendation(req.params.recommendationId, actorBody(req, 'actor'));
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Failed to execute approved recommendation:', error);
    sendError(res, error, 'Failed to execute approved recommendation');
  }
});

module.exports = router;
