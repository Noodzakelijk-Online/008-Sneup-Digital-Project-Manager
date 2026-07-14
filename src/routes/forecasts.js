const express = require('express');
const Board = require('../models/Board');
const CapacityProfile = require('../models/CapacityProfile');
const Member = require('../models/Member');
const forecastService = require('../services/forecastService');
const operationsLedgerService = require('../services/operationsLedgerService');
const { getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');
const { clampInteger, requirePermission, validateObjectIdParam } = require('../utils/requestSecurity');

const router = express.Router();
router.param('boardId', validateObjectIdParam('boardId'));
router.param('memberId', validateObjectIdParam('memberId'));

const sendError = (res, error, fallback) => res.status(error.statusCode || 500).json({
  success: false,
  error: error.statusCode ? error.message : fallback
});

const normalizeTimeOff = (items) => {
  if (!Array.isArray(items)) return [];
  if (items.length > 50) {
    const error = new Error('timeOff may include at most 50 date ranges');
    error.statusCode = 400;
    throw error;
  }
  return items.map((item) => {
    const startDate = new Date(item.startDate);
    const endDate = new Date(item.endDate);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
      const error = new Error('Each timeOff range needs valid startDate and endDate values');
      error.statusCode = 400;
      throw error;
    }
    return { startDate, endDate, label: String(item.label || '').trim().slice(0, 160) };
  });
};

const CAPACITY_EVIDENCE_PROVIDERS = new Set(['float', 'resource_guru', 'google_workspace', 'microsoft_365', 'toggl_track', 'clockify']);
const RESOURCING_PROJECT_PROVIDERS = new Set(['float', 'resource_guru']);
const SAFE_PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9@._+-]{0,159}$/;
const normalizeExternalIdentities = (items) => {
  if (!Array.isArray(items)) return [];
  if (items.length > 10) {
    const error = new Error('externalIdentities may include at most 10 provider mappings');
    error.statusCode = 400;
    throw error;
  }
  const seen = new Set();
  return items.map((item) => {
    const provider = String(item?.provider || '').trim().toLowerCase();
    const externalId = String(item?.externalId || '').trim();
    if (!CAPACITY_EVIDENCE_PROVIDERS.has(provider) || !SAFE_PROVIDER_ID.test(externalId)) {
      const error = new Error('Each external identity needs a supported provider and a safe provider ID');
      error.statusCode = 400;
      throw error;
    }
    const key = `${provider}:${externalId}`;
    if (seen.has(key)) {
      const error = new Error('External identity mappings must be unique per capacity profile');
      error.statusCode = 400;
      throw error;
    }
    seen.add(key);
    return { provider, externalId };
  });
};

const normalizeProjectMappings = (items) => {
  if (!Array.isArray(items)) return [];
  if (items.length > 20) {
    const error = new Error('externalProjectMappings may include at most 20 provider projects');
    error.statusCode = 400;
    throw error;
  }
  const seen = new Set();
  return items.map((item) => {
    const provider = String(item?.provider || '').trim().toLowerCase();
    const projectId = String(item?.projectId || '').trim();
    if (!RESOURCING_PROJECT_PROVIDERS.has(provider) || !SAFE_PROVIDER_ID.test(projectId)) {
      const error = new Error('Each project mapping needs a supported resourcing provider and a safe project ID');
      error.statusCode = 400;
      throw error;
    }
    const key = `${provider}:${projectId}`;
    if (seen.has(key)) {
      const error = new Error('Project mappings must be unique per board');
      error.statusCode = 400;
      throw error;
    }
    seen.add(key);
    return { provider, projectId };
  });
};

router.get('/', async (req, res) => {
  try {
    const forecast = await forecastService.getForecast({ workspaceId: getRequestWorkspaceObjectId(req) });
    res.json({ success: true, forecast });
  } catch (error) {
    sendError(res, error, 'Failed to calculate delivery forecast');
  }
});

router.get('/boards/:boardId', async (req, res) => {
  try {
    const forecast = await forecastService.getBoardForecast(req.params.boardId, { workspaceId: getRequestWorkspaceObjectId(req) });
    res.json({ success: true, forecast });
  } catch (error) {
    sendError(res, error, 'Failed to calculate board forecast');
  }
});

router.post('/capacity/:memberId', requirePermission('capacity:manage'), async (req, res) => {
  try {
    operationsLedgerService.requireDatabase();
    const workspaceId = getRequestWorkspaceObjectId(req);
    const member = await Member.findOne({ _id: req.params.memberId, workspaceId });
    if (!member) return res.status(404).json({ success: false, error: 'Member not found' });

    const before = await CapacityProfile.findOne({ workspaceId, memberId: member._id });
    const weeklyHours = clampInteger(req.body.weeklyHours, 32, 1, 80);
    const allocationPercent = clampInteger(req.body.allocationPercent, 100, 0, 100);
    const focusHoursPerWeek = clampInteger(req.body.focusHoursPerWeek, 4, 0, weeklyHours);
    const profile = await CapacityProfile.findOneAndUpdate(
      { workspaceId, memberId: member._id },
      {
        $set: {
          weeklyHours,
          allocationPercent,
          focusHoursPerWeek,
          timeOff: normalizeTimeOff(req.body.timeOff),
          skills: Array.isArray(req.body.skills) ? req.body.skills.map(skill => String(skill).trim()).filter(Boolean).slice(0, 30) : [],
          externalIdentities: normalizeExternalIdentities(req.body.externalIdentities),
          active: req.body.active !== false
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await operationsLedgerService.recordAudit({
      workspaceId,
      entityType: 'capacity_profile',
      entityId: profile._id,
      action: before ? 'capacity_profile_updated' : 'capacity_profile_created',
      actor: req.auth?.actorId || 'sneup',
      source: 'api',
      riskLevel: 'medium',
      beforeState: before?.toObject() || null,
      afterState: profile.toObject()
    });

    res.json({ success: true, profile });
  } catch (error) {
    sendError(res, error, 'Failed to update capacity profile');
  }
});

router.post('/boards/:boardId/project-mappings', requirePermission('capacity:manage'), async (req, res) => {
  try {
    operationsLedgerService.requireDatabase();
    const workspaceId = getRequestWorkspaceObjectId(req);
    const board = await Board.findOne({ _id: req.params.boardId, workspaceId });
    if (!board) return res.status(404).json({ success: false, error: 'Board not found' });

    const externalProjectMappings = normalizeProjectMappings(req.body.externalProjectMappings);
    for (const mapping of externalProjectMappings) {
      const mappedElsewhere = await Board.findOne({
        workspaceId,
        _id: { $ne: board._id },
        externalProjectMappings: { $elemMatch: mapping }
      }).select('_id name');
      if (mappedElsewhere) {
        const error = new Error(`This ${mapping.provider} project is already mapped to ${mappedElsewhere.name || 'another board'}`);
        error.statusCode = 409;
        throw error;
      }
    }

    const beforeState = board.toObject();
    board.externalProjectMappings = externalProjectMappings;
    await board.save();

    await operationsLedgerService.recordAudit({
      workspaceId,
      entityType: 'board',
      entityId: board._id,
      action: 'board_project_mappings_updated',
      actor: req.auth?.actorId || 'sneup',
      source: 'api',
      riskLevel: 'medium',
      beforeState,
      afterState: board.toObject()
    });

    res.json({ success: true, board });
  } catch (error) {
    sendError(res, error, 'Failed to update board project mappings');
  }
});

module.exports = router;
