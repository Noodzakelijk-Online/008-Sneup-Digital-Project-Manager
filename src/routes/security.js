const express = require('express');
const router = express.Router();
const responseTimingService = require('../services/responseTimingService');
const { getDemoSecurityContext, isDemoMode } = require('../services/demoWorkspaceService');
const { getRateLimitMetrics, requirePermission } = require('../utils/requestSecurity');

const publicAuthContext = (auth = {}) => ({
  authenticated: Boolean(auth.authenticated),
  authMethod: auth.authMethod || 'none',
  actorType: auth.actorType || 'anonymous',
  actorId: auth.actorId || null,
  displayName: auth.displayName || null,
  workspaceId: auth.workspaceId || null,
  workspaceName: auth.workspaceName || null,
  roles: auth.roles || [],
  permissions: auth.permissions || [],
  tokenId: auth.tokenId || null,
  userId: auth.userId || null,
  localRequest: Boolean(auth.localRequest),
  workspaceOverrideAllowed: Boolean(auth.workspaceOverrideAllowed || auth.localRequest)
});

router.get('/context', requirePermission('api:read'), (req, res) => {
  const demoMode = isDemoMode();
  res.json({
    success: true,
    context: demoMode ? getDemoSecurityContext() : publicAuthContext(req.auth),
    controls: {
      apiKeyConfigured: Boolean(process.env.SNEUP_API_KEY),
      apiKeyRequired: process.env.SNEUP_REQUIRE_API_KEY === 'true',
      workspaceScoped: true,
      trelloWritesApprovalGated: true,
      demoMode
    }
  });
});

router.get('/response-timing', requirePermission('audit:read'), (req, res) => {
  res.json({
    success: true,
    timing: responseTimingService.getSummary(),
    rateLimit: getRateLimitMetrics()
  });
});

module.exports = router;
