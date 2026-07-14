const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { sanitizeLogInfo } = require('./logSanitizer');
const LOGGER_INSTANCE = Symbol.for('sneup.loggerInstance');

// Desktop builds provide a writable per-user location; server deployments keep local logs.
const logsDir = process.env.SNEUP_LOG_DIR || path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log format
const sanitizeFormat = winston.format((info) => {
  const sanitized = sanitizeLogInfo(info);
  for (const key of Object.keys(info)) delete info[key];
  Object.assign(info, sanitized);
  return info;
});

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  sanitizeFormat(),
  winston.format.json()
);

// Define console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  sanitizeFormat(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

const createLogger = () => {
  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    defaultMeta: { service: 'sneup' },
    transports: [
      new winston.transports.File({
        filename: path.join(logsDir, 'combined.log'),
        maxsize: 10485760,
        maxFiles: 5
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error',
        maxsize: 10485760,
        maxFiles: 5
      })
    ],
    exceptionHandlers: [
      new winston.transports.File({
        filename: path.join(logsDir, 'exceptions.log')
      })
    ],
    rejectionHandlers: [
      new winston.transports.File({
        filename: path.join(logsDir, 'rejections.log')
      })
    ]
  });

  if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({ format: consoleFormat }));
  }

  return logger;
};

// Winston installs global exception handlers, so reuse one logger across module reloads.
const logger = process[LOGGER_INSTANCE] || createLogger();
if (!process[LOGGER_INSTANCE]) process[LOGGER_INSTANCE] = logger;

module.exports = logger;
