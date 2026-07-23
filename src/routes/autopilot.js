const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const autopilotService = require('../services/autopilotService');
const operationsBriefService = require('../services/operationsBriefService');
const { getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');
const { requirePermission } = require('../utils/requestSecurity');
const { getAuthenticatedActor } = require('../utils/requestActor');

const sendError = (res, error, fallback) => res.status(error.statusCode || 500).json({
  success: false,
  error: error.statusCode ? error.message : fallback
});

router.get('/mission-control', requirePermission('audit:read'), async (req, res) => {
  try {
    const snapshot = await autopilotService.getMissionControl({
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    res.json({
      success: true,
      snapshot
    });
  } catch (error) {
    logger.error('Failed to get mission control:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get mission control'
    });
  }
});

router.get('/operations-brief', requirePermission('audit:read'), async (req, res) => {
  try {
    const brief = await operationsBriefService.getDailyBrief({
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    res.json({
      success: true,
      brief
    });
  } catch (error) {
    logger.error('Failed to get operations brief:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get operations brief'
    });
  }
});

router.post('/commands/queue', requirePermission('autopilot:queue'), async (req, res) => {
  try {
    const result = await autopilotService.queueCommandForApproval(req.body.command, {
      actor: getAuthenticatedActor(req),
      workspaceId: getRequestWorkspaceObjectId(req)
    });

    res.json({
      success: true,
      message: result.created ? 'Autopilot command queued for approval' : 'Autopilot command is already queued',
      ...result
    });
  } catch (error) {
    logger.error('Failed to queue autopilot command:', error);
    sendError(res, error, 'Failed to queue autopilot command');
  }
});

router.post('/commands/queue-all', requirePermission('autopilot:queue'), async (req, res) => {
  try {
    const result = await autopilotService.queueMissionControlCommands({
      actor: getAuthenticatedActor(req),
      workspaceId: getRequestWorkspaceObjectId(req),
      limit: req.body.limit
    });

    res.json({
      success: true,
      message: `Queued ${result.count} autopilot command${result.count === 1 ? '' : 's'} for approval`,
      ...result
    });
  } catch (error) {
    logger.error('Failed to queue mission control commands:', error);
    sendError(res, error, 'Failed to queue mission control commands');
  }
});

module.exports = router;
