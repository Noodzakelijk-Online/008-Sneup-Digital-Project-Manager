const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const Intervention = require('../models/Intervention');
const Recommendation = require('../models/Recommendation');
const operationsLedgerService = require('../services/operationsLedgerService');
const { getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');
const { requirePermission, validateObjectIdParam } = require('../utils/requestSecurity');
const { bodyWithAuthenticatedActor } = require('../utils/requestActor');

const RESPONSE_ELIGIBLE_TYPES = new Set(['comment', 'follow_up', 'escalate']);

router.param('interventionId', validateObjectIdParam('interventionId'));

const workspaceOptions = (req) => ({
  workspaceId: getRequestWorkspaceObjectId(req)
});

router.post('/:interventionId/execute-approved', requirePermission('trello-actions:execute-approved'), async (req, res) => {
  try {
    const intervention = await Intervention.findOne({
      _id: req.params.interventionId,
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    if (!intervention) {
      return res.status(404).json({ success: false, error: 'Intervention not found' });
    }

    const recommendationId = intervention.metadata?.recommendationId;
    const recommendation = recommendationId
      ? await Recommendation.findOne({ _id: recommendationId, workspaceId: getRequestWorkspaceObjectId(req) })
      : await Recommendation.findOne({ interventionId: intervention._id, workspaceId: getRequestWorkspaceObjectId(req) }).sort({ createdAt: -1 });

    if (!recommendation) {
      return res.status(404).json({ success: false, error: 'Recommendation not found for intervention' });
    }

    const result = await operationsLedgerService.executeApprovedRecommendation(recommendation._id, {
      ...bodyWithAuthenticatedActor(req, 'actor'),
      ...workspaceOptions(req),
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Failed to execute approved intervention:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to execute approved intervention'
    });
  }
});

router.post('/:interventionId/record-response', requirePermission('worker-responses:record'), async (req, res) => {
  try {
    const intervention = await Intervention.findOne({
      _id: req.params.interventionId,
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    if (!intervention) {
      return res.status(404).json({ success: false, error: 'Intervention not found' });
    }
    if (intervention.status !== 'executed') {
      return res.status(409).json({ success: false, error: 'A worker response can only be recorded after the intervention is executed' });
    }
    if (!RESPONSE_ELIGIBLE_TYPES.has(intervention.type)) {
      return res.status(400).json({ success: false, error: 'Only communication interventions can receive a worker response' });
    }
    if (!intervention.memberId) {
      return res.status(409).json({ success: false, error: 'The executed intervention has no accountable worker' });
    }
    if (intervention.response?.respondedAt) {
      return res.status(409).json({ success: false, error: 'A worker response is already recorded for this intervention' });
    }

    const recommendation = await Recommendation.findOne({
      interventionId: intervention._id,
      workspaceId: getRequestWorkspaceObjectId(req)
    }).sort({ createdAt: -1 });

    const response = await operationsLedgerService.recordWorkerResponse({
      ...bodyWithAuthenticatedActor(req, 'actor'),
      ...workspaceOptions(req),
      interventionId: intervention._id,
      recommendationId: recommendation?._id,
      boardId: intervention.boardId,
      cardId: intervention.cardId,
      memberId: intervention.memberId,
    });

    return res.json({ success: true, response });
  } catch (error) {
    logger.error('Failed to record intervention response:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to record intervention response'
    });
  }
});

module.exports = router;
