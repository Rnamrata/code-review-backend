import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { appConfig } from '../config/app.config';

const logDirectory = path.resolve(appConfig.logDirectory || './logs');

// The folder is only needed for the log files, so it is only created when they are written.
if (appConfig.logToFile && !fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory, { recursive: true });
}

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    
    // Add metadata if present
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata, null, 2)}`;
    }
    
    return msg;
  })
);


const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);


const transports: winston.transport[] = [];

// Console transport (for development)
if (appConfig.logToConsole) {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
      level: appConfig.logLevel
    })
  );
}

// File transports (for production and debugging)
if (appConfig.logToFile) {
  // Error log file - only errors
  transports.push(
    new winston.transports.File({
      filename: path.join(logDirectory, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  );

  // Combined log file - all logs
  transports.push(
    new winston.transports.File({
      filename: path.join(logDirectory, 'combined.log'),
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  );

  // HTTP access log file - only http requests
  transports.push(
    new winston.transports.File({
      filename: path.join(logDirectory, 'access.log'),
      level: 'http',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  );
}

const logger = winston.createLogger({
  level: appConfig.logLevel || 'info',
  levels: winston.config.npm.levels,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.metadata()
  ),
  transports,
  exitOnError: false,
  // Handle uncaught exceptions and unhandled rejections
  exceptionHandlers: appConfig.logToFile
    ? [
        new winston.transports.File({
          filename: path.join(logDirectory, 'exceptions.log')
        })
      ]
    : [],
  rejectionHandlers: appConfig.logToFile
    ? [
        new winston.transports.File({
          filename: path.join(logDirectory, 'rejections.log')
        })
      ]
    : []
});

/**
 * Log error with enhanced context
 * 
 * @param error - Error object
 * @param context - Additional context about where/why error occurred
 * 
 * @example
 * try {
 *   // operation
 * } catch (error) {
 *   logError(error, { operation: 'fileUpload', filename: 'auth.py' });
 * }
 */
export const logError = (
  error: Error | unknown,
  context?: Record<string, any>
): void => {
  const err = error instanceof Error ? error : new Error(String(error));

  logger.error(err.message, {
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack
    },
    ...context
  });
};

/**
 * Create a child logger with preset context
 * Useful for adding consistent metadata to all logs in a specific context
 * 
 * @param context - Context to add to all logs from this child logger
 * @returns Child logger instance
 * 
 * @example
 * const sessionLogger = createChildLogger({ sessionId: 'abc-123' });
 * sessionLogger.info('Starting analysis'); // Automatically includes sessionId
 */
export const createChildLogger = (
  context: Record<string, any>
): winston.Logger => {
  return logger.child(context);
};

/**
 * Log application startup information
 * 
 * @param port - Server port
 * @param environment - Environment (development, production)
 */
export const logStartup = (port: number | string, environment: string): void => {
  logger.info('='.repeat(50));
  logger.info('🚀 Application Starting');
  logger.info('='.repeat(50));
  logger.info(`Environment: ${environment}`);
  logger.info(`Port: ${port}`);
  logger.info(`Log Level: ${appConfig.logLevel}`);
  logger.info(appConfig.logToFile ? `Log Directory: ${logDirectory}` : 'Log files: off');
  logger.info(`Node Version: ${process.version}`);
  logger.info(`Platform: ${process.platform}`);
  logger.info('='.repeat(50));
};

/**
 * Log application shutdown
 * 
 * @param reason - Reason for shutdown
 */
export const logShutdown = (reason: string): void => {
  logger.info('='.repeat(50));
  logger.warn('⚠️  Application Shutting Down');
  logger.info(`Reason: ${reason}`);
  logger.info('='.repeat(50));
};

/**
 * Log security event
 * 
 * @param event - Security event type
 * @param metadata - Event metadata
 */
export const logSecurity = (
  event: 'rate_limit_exceeded' | 'invalid_request' | 'suspicious_activity',
  metadata?: Record<string, any>
): void => {
  logger.warn(`🔒 Security: ${event}`, {
    event,
    ...metadata
  });
};

/**
 * Log performance metrics
 * 
 * @param operation - Operation name
 * @param duration - Duration in milliseconds
 * @param metadata - Additional metadata
 */
export const logPerformance = (
  operation: string,
  duration: number,
  metadata?: Record<string, any>,
  slowAfterMs: number = 1000
): void => {
  const level = duration > slowAfterMs ? 'warn' : 'debug';

  logger.log(level, `⚡ Performance: ${operation}`, {
    operation,
    duration: `${duration}ms`,
    ...metadata
  });
};

export { logger };
export default logger;