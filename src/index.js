require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const logger = require('./utils/logger');
const { connectDatabase } = require('./utils/database');
const trelloSync = require('./services/trelloSync');
const analyticsService = require('./services/analyticsService');
const interventionEngine = require('./services/interventionEngine');
const performanceTracker = require('./services/performanceTracker');

// Import routes
const boardRoutes = require('./routes/boards');
const analyticsRoutes = require('./routes/analytics');
const teamRoutes = require('./routes/team');
const webhookRoutes = require('./routes/webhooks');
const chatRoutes = require('./routes/chat');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API routes
app.use('/api/boards', boardRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/chat', chatRoutes);

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
      'Accountability reports'
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
    
    // Connect to database
    await connectDatabase();
    
    // Initialize Trello synchronization
    await trelloSync.initSync();
    
    // Initialize analytics service
    analyticsService.initAnalytics();
    
    // Initialize intervention worker (v2.0)
    const interventionWorker = require('./workers/interventionWorker');
    interventionWorker.init();
    
    // Initialize performance worker (v2.0)
    const performanceWorker = require('./workers/performanceWorker');
    performanceWorker.init();
    
    // Start server
    app.listen(PORT, () => {
      logger.info(`Sneup server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the application
initApp();

module.exports = app;
