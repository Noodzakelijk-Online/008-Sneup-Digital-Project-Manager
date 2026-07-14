require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const logger = require('./utils/logger');
const { registerProcessHandlers } = require('./utils/processHandlers');
const { connectDatabase, getDatabaseStatus } = require('./utils/database');
const {
  apiRateLimit,
  corsOptions,
  requireApiAccess
} = require('./utils/requestSecurity');
const trelloSync = require('./services/trelloSync');
const analyticsService = require('./services/analyticsService');
const connectorSyncService = require('./services/connectorSyncService');
const workspaceScopeService = require('./services/workspaceScopeService');

// Import routes
const boardRoutes = require('./routes/boards');
const analyticsRoutes = require('./routes/analytics');
const teamRoutes = require('./routes/team');
const webhookRoutes = require('./routes/webhooks');
const chatRoutes = require('./routes/chat');
const connectorRoutes = require('./routes/connectors');
const autopilotRoutes = require('./routes/autopilot');
const enhancementRoutes = require('./routes/enhancements');
const recommendationRoutes = require('./routes/recommendations');
const decisionQueueRoutes = require('./routes/decisionQueue');
const auditRoutes = require('./routes/audit');
const trelloActionRoutes = require('./routes/trelloActions');
const followUpRoutes = require('./routes/followUps');
const cardRoutes = require('./routes/cards');
const interventionRoutes = require('./routes/interventions');
const findingRoutes = require('./routes/findings');
const jobRoutes = require('./routes/jobs');
const securityRoutes = require('./routes/security');
const workspaceRoutes = require('./routes/workspaces');
const workSignalRoutes = require('./routes/workSignals');
const reportRoutes = require('./routes/reports');
const forecastRoutes = require('./routes/forecasts');
const notificationRoutes = require('./routes/notifications');
const policyRuleRoutes = require('./routes/policyRules');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
let server;

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  }
}));
app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({
  limit: process.env.SNEUP_JSON_LIMIT || '1mb',
  verify: (req, res, buffer) => {
    req.rawBody = buffer;
  }
}));
app.use(express.urlencoded({
  extended: true,
  limit: process.env.SNEUP_FORM_LIMIT || '256kb'
}));

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});
app.use(apiRateLimit);
app.use(requireApiAccess);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: { state: getDatabaseStatus().state },
    demoMode: process.env.SNEUP_DEMO_MODE === 'true'
  });
});

// API routes
app.use('/api/boards', boardRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/connectors', connectorRoutes);
app.use('/api/autopilot', autopilotRoutes);
app.use('/api/enhancements', enhancementRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/decision-queue', decisionQueueRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/trello-actions', trelloActionRoutes);
app.use('/api/follow-ups', followUpRoutes);
app.use('/api/cards', cardRoutes);
app.use('/api/interventions', interventionRoutes);
app.use('/api/findings', findingRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/work-signals', workSignalRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/forecasts', forecastRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/policy-rules', policyRuleRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Sneup',
    version: '2.0.0',
    description: 'Autonomous AI-powered digital project manager for Trello with proactive management and conversational AI',
    status: 'running',
    features: [
      'Proactive interventions',
      'Performance tracking',
      'Conversational AI',
      'Priority engine',
      'Account connectors',
      'Enhancement backlog',
      'Approval-gated recommendations',
      'Operations ledger',
      'Job observability',
      'Cross-tool work signals',
      'Accountability reports',
      'Capacity-aware P50/P80 delivery forecasts'
    ]
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path
  });
});

// Initialize application
const initApp = async () => {
  try {
    logger.info('Starting Sneup...');
    
    let databaseConnected = false;

    if (process.env.SNEUP_DEMO_MODE === 'true') {
      logger.warn('Sneup demo mode enabled. Skipping MongoDB connection.');
    } else {
      try {
        await connectDatabase();
        databaseConnected = true;
        const workspaceBackfill = await workspaceScopeService.backfillDefaultWorkspace();
        const policyRuleIndexMigration = await workspaceScopeService.ensurePolicyRuleIndexes();
        if (workspaceBackfill.totalModified > 0) {
          logger.info('Default workspace migration applied', workspaceBackfill);
        }
        if (policyRuleIndexMigration.removedLegacyNameIndex) {
          logger.info('Migrated legacy global PolicyRule name index');
        }
      } catch (error) {
        logger.warn('MongoDB is not available. Starting Sneup in catalog/demo mode.');
        process.env.SNEUP_DEMO_MODE = 'true';
      }
    }

    const hasTrelloCredentials = Boolean(process.env.TRELLO_API_KEY && process.env.TRELLO_API_TOKEN);

    if (databaseConnected && hasTrelloCredentials) {
      await trelloSync.initSync();
    } else if (!hasTrelloCredentials) {
      logger.warn('Trello credentials are not configured. Skipping Trello synchronization.');
    }

    if (databaseConnected) {
      analyticsService.initAnalytics();
      connectorSyncService.init();

      const interventionWorker = require('./workers/interventionWorker');
      interventionWorker.init();

      const performanceWorker = require('./workers/performanceWorker');
      performanceWorker.init();

      const notificationWorker = require('./workers/notificationWorker');
      notificationWorker.init();
    } else {
      logger.warn('Background analytics and intervention workers are paused until MongoDB is connected.');
    }
    
    // Start server
    server = app.listen(PORT, HOST, () => {
      logger.info(`Sneup server running on http://${HOST}:${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    return server;
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    process.exit(1);
  }
};

// Process handlers are global: register once even when Sneup is embedded or hot-reloaded.
registerProcessHandlers(logger);

if (require.main === module) {
  initApp();
}

app.initApp = initApp;
app.getServer = () => server;
module.exports = app;
