const express = require('express');
const policyRuleService = require('../services/policyRuleService');
const { getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');
const { requirePermission } = require('../utils/requestSecurity');
const logger = require('../utils/logger');

const router = express.Router();

const options = (req) => ({
  workspaceId: getRequestWorkspaceObjectId(req),
  actor: req.auth?.actorId
});

const sendError = (res, error, fallback) => res.status(error.statusCode || 500).json({
  success: false,
  error: error.statusCode ? error.message : fallback
});

router.get('/', requirePermission('audit:read'), async (req, res) => {
  try {
    const policies = await policyRuleService.listEffectivePolicies(options(req));
    res.json({ success: true, count: policies.length, policies });
  } catch (error) {
    logger.error('Failed to list Trello action safety policies:', error);
    sendError(res, error, 'Failed to list Trello action safety policies');
  }
});

router.get('/history', requirePermission('audit:read'), async (req, res) => {
  try {
    const history = await policyRuleService.listPolicyHistory({
      ...options(req),
      limit: req.query.limit
    });
    res.json({ success: true, count: history.length, history });
  } catch (error) {
    logger.error('Failed to list Trello action safety policy history:', error);
    sendError(res, error, 'Failed to list Trello action safety policy history');
  }
});

router.put('/:actionType', requirePermission('policy-rules:manage'), async (req, res) => {
  try {
    const policy = await policyRuleService.updateActionPolicy(req.params.actionType, req.body, options(req));
    res.json({ success: true, policy });
  } catch (error) {
    logger.error('Failed to update Trello action safety policy:', error);
    sendError(res, error, 'Failed to update Trello action safety policy');
  }
});

module.exports = router;
