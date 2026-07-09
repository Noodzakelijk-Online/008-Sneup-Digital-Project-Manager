const PROCESS_HANDLERS_REGISTERED = Symbol.for('sneup.processHandlersRegistered');

const registerProcessHandlers = (logger, options = {}) => {
  const runtime = options.runtime || process;
  const exit = options.exit || runtime.exit.bind(runtime);
  if (runtime[PROCESS_HANDLERS_REGISTERED]) return false;
  runtime[PROCESS_HANDLERS_REGISTERED] = true;

  runtime.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully...');
    exit(0);
  });

  runtime.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully...');
    exit(0);
  });

  runtime.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    exit(1);
  });

  runtime.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    exit(1);
  });

  return true;
};

module.exports = {
  PROCESS_HANDLERS_REGISTERED,
  registerProcessHandlers
};
