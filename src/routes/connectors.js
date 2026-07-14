const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const accountConnectorService = require('../services/accountConnectorService');
const { getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');
const { requirePermission, validateObjectIdParam } = require('../utils/requestSecurity');

router.param('accountId', validateObjectIdParam('accountId'));

const getBaseUrl = (req) => {
  const protocol = req.protocol;
  return `${protocol}://${req.get('host')}`;
};

const connectorRequestOptions = (req) => ({
  workspaceId: getRequestWorkspaceObjectId(req),
  actorId: req.auth?.actorId
});

const sendError = (res, error) => {
  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Connector operation failed'
  });
};

router.get('/', async (req, res) => {
  try {
    const catalog = accountConnectorService.getCatalog({
      category: req.query.category,
      search: req.query.search || req.query.q,
      limit: req.query.limit,
      offset: req.query.offset
    });
    const accounts = await accountConnectorService.listAccounts(connectorRequestOptions(req));
    res.json({
      success: true,
      ...catalog,
      accounts
    });
  } catch (error) {
    logger.error('Failed to get connector catalog:', error);
    sendError(res, error);
  }
});

router.get('/categories', (req, res) => {
  try {
    res.json({
      success: true,
      categories: accountConnectorService.getCatalog().categories
    });
  } catch (error) {
    logger.error('Failed to get connector categories:', error);
    sendError(res, error);
  }
});

router.get('/safety', (req, res) => {
  try {
    const catalog = accountConnectorService.getCatalog();
    res.json({
      success: true,
      safety: catalog.safety
    });
  } catch (error) {
    logger.error('Failed to get connector safety summary:', error);
    sendError(res, error);
  }
});

router.get('/accounts', async (req, res) => {
  try {
    const accounts = await accountConnectorService.listAccounts(connectorRequestOptions(req));
    res.json({
      success: true,
      count: accounts.length,
      accounts
    });
  } catch (error) {
    logger.error('Failed to list connector accounts:', error);
    sendError(res, error);
  }
});

router.post('/accounts/:accountId/validate', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const account = await accountConnectorService.markAccountValidated(req.params.accountId, connectorRequestOptions(req));
    res.json({
      success: true,
      account
    });
  } catch (error) {
    logger.error('Failed to validate connector account:', error);
    sendError(res, error);
  }
});

router.post('/accounts/:accountId/rotate-credentials', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const account = await accountConnectorService.rotateCredentialAccount(
      req.params.accountId,
      req.body,
      connectorRequestOptions(req)
    );
    res.json({ success: true, account });
  } catch (error) {
    logger.error('Failed to rotate connector credentials:', error);
    sendError(res, error);
  }
});

router.delete('/accounts/:accountId', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const result = await accountConnectorService.deleteAccount(req.params.accountId, connectorRequestOptions(req));
    res.json(result);
  } catch (error) {
    logger.error('Failed to delete connector account:', error);
    sendError(res, error);
  }
});

router.get('/accounts/:accountId/jira-sites', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const sites = await accountConnectorService.getJiraSites(req.params.accountId, connectorRequestOptions(req));
    res.json({
      success: true,
      sites
    });
  } catch (error) {
    logger.error('Failed to list Jira sites:', error);
    sendError(res, error);
  }
});

router.post('/accounts/:accountId/jira-site', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const account = await accountConnectorService.selectJiraSite(
      req.params.accountId,
      req.body.cloudId,
      connectorRequestOptions(req)
    );
    res.json({
      success: true,
      account
    });
  } catch (error) {
    logger.error('Failed to select Jira site:', error);
    sendError(res, error);
  }
});

router.get('/accounts/:accountId/confluence-sites', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const sites = await accountConnectorService.getConfluenceSites(req.params.accountId, connectorRequestOptions(req));
    res.json({ success: true, sites });
  } catch (error) {
    logger.error('Failed to list Confluence sites:', error);
    sendError(res, error);
  }
});

router.post('/accounts/:accountId/confluence-site', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const account = await accountConnectorService.selectConfluenceSite(
      req.params.accountId,
      req.body.cloudId,
      connectorRequestOptions(req)
    );
    res.json({ success: true, account });
  } catch (error) {
    logger.error('Failed to select Confluence site:', error);
    sendError(res, error);
  }
});

router.get('/accounts/:accountId/asana-workspaces', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const workspaces = await accountConnectorService.getAsanaWorkspaces(req.params.accountId, connectorRequestOptions(req));
    res.json({
      success: true,
      workspaces
    });
  } catch (error) {
    logger.error('Failed to list Asana workspaces:', error);
    sendError(res, error);
  }
});

router.post('/accounts/:accountId/asana-workspace', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const account = await accountConnectorService.selectAsanaWorkspace(
      req.params.accountId,
      req.body.workspaceGid,
      connectorRequestOptions(req)
    );
    res.json({
      success: true,
      account
    });
  } catch (error) {
    logger.error('Failed to select Asana workspace:', error);
    sendError(res, error);
  }
});

router.get('/accounts/:accountId/basecamp-accounts', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const accounts = await accountConnectorService.getBasecampAccounts(req.params.accountId, connectorRequestOptions(req));
    res.json({ success: true, accounts });
  } catch (error) {
    logger.error('Failed to list Basecamp accounts:', error);
    sendError(res, error);
  }
});

router.post('/accounts/:accountId/basecamp-account', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const account = await accountConnectorService.selectBasecampAccount(
      req.params.accountId,
      req.body.basecampAccountId,
      connectorRequestOptions(req)
    );
    res.json({ success: true, account });
  } catch (error) {
    logger.error('Failed to select Basecamp account:', error);
    sendError(res, error);
  }
});

router.get('/accounts/:accountId/resource-guru-accounts', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const accounts = await accountConnectorService.getResourceGuruAccounts(req.params.accountId, connectorRequestOptions(req));
    res.json({ success: true, accounts });
  } catch (error) {
    logger.error('Failed to list Resource Guru accounts:', error);
    sendError(res, error);
  }
});

router.post('/accounts/:accountId/resource-guru-account', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const account = await accountConnectorService.selectResourceGuruAccount(
      req.params.accountId,
      req.body.resourceGuruAccountId,
      connectorRequestOptions(req)
    );
    res.json({ success: true, account });
  } catch (error) {
    logger.error('Failed to select Resource Guru account:', error);
    sendError(res, error);
  }
});

router.post('/accounts/:accountId/figma-team', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const account = await accountConnectorService.selectFigmaTeam(
      req.params.accountId,
      req.body.figmaTeamId,
      connectorRequestOptions(req)
    );
    res.json({ success: true, account });
  } catch (error) {
    logger.error('Failed to configure Figma team:', error);
    sendError(res, error);
  }
});

router.get('/accounts/:accountId/sharepoint-sites', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const sites = await accountConnectorService.getSharePointSites(req.params.accountId, connectorRequestOptions(req));
    res.json({ success: true, sites });
  } catch (error) {
    logger.error('Failed to list SharePoint sites:', error);
    sendError(res, error);
  }
});

router.post('/accounts/:accountId/sharepoint-site', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const account = await accountConnectorService.selectSharePointSite(
      req.params.accountId,
      req.body.sharePointSiteId,
      connectorRequestOptions(req)
    );
    res.json({ success: true, account });
  } catch (error) {
    logger.error('Failed to select SharePoint site:', error);
    sendError(res, error);
  }
});

router.get('/accounts/:accountId/mural-workspaces', requirePermission('connectors:manage'), async (req, res) => {
  try { res.json({ success: true, workspaces: await accountConnectorService.getMuralWorkspaces(req.params.accountId, connectorRequestOptions(req)) }); } catch (error) { logger.error('Failed to list Mural workspaces:', error); sendError(res, error); }
});
router.post('/accounts/:accountId/mural-workspace', requirePermission('connectors:manage'), async (req, res) => {
  try { res.json({ success: true, account: await accountConnectorService.selectMuralWorkspace(req.params.accountId, req.body.muralWorkspaceId, connectorRequestOptions(req)) }); } catch (error) { logger.error('Failed to select Mural workspace:', error); sendError(res, error); }
});

router.get('/accounts/:accountId/xero-tenants', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const tenants = await accountConnectorService.getXeroTenants(req.params.accountId, connectorRequestOptions(req));
    res.json({ success: true, tenants });
  } catch (error) {
    logger.error('Failed to list Xero organisations:', error);
    sendError(res, error);
  }
});

router.post('/accounts/:accountId/xero-tenant', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const account = await accountConnectorService.selectXeroTenant(
      req.params.accountId,
      req.body.xeroTenantId,
      connectorRequestOptions(req)
    );
    res.json({ success: true, account });
  } catch (error) {
    logger.error('Failed to select Xero organisation:', error);
    sendError(res, error);
  }
});

router.get('/:connectorId', (req, res) => {
  try {
    const connector = accountConnectorService.getConnectorDetails(req.params.connectorId);
    if (!connector) {
      return res.status(404).json({
        success: false,
        error: 'Connector not found'
      });
    }

    res.json({
      success: true,
      connector
    });
  } catch (error) {
    logger.error('Failed to get connector details:', error);
    sendError(res, error);
  }
});

router.post('/:connectorId/connect', requirePermission('connectors:manage'), (req, res) => {
  try {
    const result = accountConnectorService.beginConnection(req.params.connectorId, {
      baseUrl: getBaseUrl(req),
      returnTo: req.body.returnTo,
      scopeAcknowledged: req.body.scopeAcknowledged === true,
      actorId: req.auth?.actorId,
      workspaceId: getRequestWorkspaceObjectId(req)
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Failed to begin connector connection:', error);
    sendError(res, error);
  }
});

router.get('/:connectorId/callback', async (req, res) => {
  try {
    const result = await accountConnectorService.completeOAuth(req.params.connectorId, req.query, {
      baseUrl: getBaseUrl(req)
    });
    const separator = result.returnTo.includes('?') ? '&' : '?';
    res.redirect(`${result.returnTo}${separator}connector=${encodeURIComponent(result.account.connectorId)}&status=connected`);
  } catch (error) {
    logger.error('OAuth connector callback failed:', error);
    res.status(error.statusCode || 500).send(`
      <!doctype html>
      <html lang="en">
        <head><meta charset="utf-8"><title>Sneup connector error</title></head>
        <body>
          <h1>Connector could not be linked</h1>
          <p>${String(error.message || 'Connector operation failed').replace(/[<>&"]/g, '')}</p>
          <p><a href="/?connectors=1">Return to Sneup</a></p>
        </body>
      </html>
    `);
  }
});

router.post('/:connectorId/accounts', requirePermission('connectors:manage'), async (req, res) => {
  try {
    const account = await accountConnectorService.saveCredentialAccount(req.params.connectorId, req.body, connectorRequestOptions(req));
    res.status(201).json({
      success: true,
      account
    });
  } catch (error) {
    logger.error('Failed to save connector account:', error);
    sendError(res, error);
  }
});

module.exports = router;
