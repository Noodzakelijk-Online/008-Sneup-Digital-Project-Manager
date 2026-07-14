const PROCESS_HANDLERS_REGISTERED = Symbol.for('sneup.processHandlersRegistered');

const registerProcessHandlers = (logger, options = {}) => {
  const runtime = options.runtime || process;
  const exit = options.exit || runtime.exit.bind(runtime);
  const shutdown = options.shutdown || (async () => {});
  if (runtime[PROCESS_HANDLERS_REGISTERED]) return false;
  runtime[PROCESS_HANDLERS_REGISTERED] = true;

  let shuttingDown = false;
  const gracefulExit = async (status, message) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(message);
    try {
      await shutdown();
      exit(status);
    } catch (error) {
      logger.error('Graceful shutdown failed:', error);
      exit(1);
    }
  };

  runtime.on('SIGTERM', () => {
    void gracefulExit(0, 'SIGTERM received, shutting down gracefully...');
  });

  runtime.on('SIGINT', () => {
    void gracefulExit(0, 'SIGINT received, shutting down gracefully...');
  });

  runtime.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    void gracefulExit(1, 'Shutting down after uncaught exception...');
  });

  runtime.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    void gracefulExit(1, 'Shutting down after unhandled rejection...');
  });

  return true;
};

module.exports = {
  PROCESS_HANDLERS_REGISTERED,
  registerProcessHandlers
};
