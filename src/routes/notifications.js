const express = require('express');
const router = express.Router();
const notificationService = require('../services/notificationService');
const { getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');
const { clampInteger, requirePermission, validateObjectIdParam } = require('../utils/requestSecurity');
const logger = require('../utils/logger');

router.param('policyId', validateObjectIdParam('policyId'));

const options = (req) => ({
  workspaceId: getRequestWorkspaceObjectId(req),
  actor: req.auth?.actorId
});

const sendError = (res, error, fallback) => res.status(error.statusCode || 500).json({
  success: false,
  error: error.statusCode ? error.message : fallback
});

router.get('/policies', requirePermission('audit:read'), async (req, res) => {
  try {
    const policies = await notificationService.listPolicies({ ...options(req), limit: clampInteger(req.query.limit, 100, 1, 100) });
    res.json({ success: true, count: policies.length, policies });
  } catch (error) {
    logger.error('Failed to list notification policies:', error);
    sendError(res, error, 'Failed to list notification policies');
  }
});

router.get('/deliveries', requirePermission('audit:read'), async (req, res) => {
  try {
    const deliveries = await notificationService.listDeliveries({
      ...options(req),
      status: req.query.status,
      policyId: req.query.policyId,
      limit: clampInteger(req.query.limit, 100, 1, 250)
    });
    res.json({ success: true, count: deliveries.length, deliveries });
  } catch (error) {
    logger.error('Failed to list notification deliveries:', error);
    sendError(res, error, 'Failed to list notification deliveries');
  }
});

router.post('/policies', requirePermission('notification-policies:manage'), async (req, res) => {
  try {
    const policy = await notificationService.createPolicy(req.body, options(req));
    res.status(201).json({ success: true, policy });
  } catch (error) {
    logger.error('Failed to create notification policy:', error);
    sendError(res, error, 'Failed to create notification policy');
  }
});

router.patch('/policies/:policyId', requirePermission('notification-policies:manage'), async (req, res) => {
  try {
    const policy = await notificationService.updatePolicy(req.params.policyId, req.body, options(req));
    res.json({ success: true, policy });
  } catch (error) {
    logger.error('Failed to update notification policy:', error);
    sendError(res, error, 'Failed to update notification policy');
  }
});

router.post('/policies/:policyId/test', requirePermission('notification-policies:manage'), async (req, res) => {
  try {
    const result = await notificationService.sendPolicyTest(req.params.policyId, {
      ...options(req),
      confirmDelivery: req.body.confirmDelivery === true
    });
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Failed to send notification policy test:', error);
    sendError(res, error, 'Failed to send notification policy test');
  }
});

router.post('/dispatch/reconciliation', requirePermission('notifications:dispatch'), async (req, res) => {
  try {
    const result = await notificationService.dispatchReconciliationAlerts(options(req));
    res.json({ success: true, result });
  } catch (error) {
    logger.error('Failed to dispatch reconciliation alerts:', error);
    sendError(res, error, 'Failed to dispatch reconciliation alerts');
  }
});

module.exports = router;
