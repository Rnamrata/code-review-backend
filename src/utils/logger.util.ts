import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { appConfig } from '../config/app.config';

const logDirectory = path.resolve(appConfig.logDirectory || './logs');

// Create logs directory if it doesn't exist
if (!fs.existsSync(logDirectory)) {
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
 * Log HTTP request
 * 
 * @param method - HTTP method (GET, POST, etc.)
 * @param url - Request URL
 * @param statusCode - Response status code
 * @param duration - Request duration in milliseconds
 * @param metadata - Additional metadata
 * 
 * @example
 * logRequest('GET', '/api/upload', 200, 45, { userId: 123 });
 */
export const logRequest = (
  method: string,
  url: string,
  statusCode: number,
  duration: number,
  metadata?: Record<string, any>
): void => {
  const level = statusCode >= 400 ? 'error' : 'http';
  const message = `${method} ${url} ${statusCode} ${duration}ms`;

  logger.log(level, message, metadata);
};

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
  logger.info(`Log Directory: ${logDirectory}`);
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
 * Log session operation
 * 
 * @param operation - Operation name (created, updated, deleted)
 * @param sessionId - Session ID
 * @param metadata - Additional metadata
 */
export const logSession = (
  operation: 'created' | 'updated' | 'deleted' | 'expired',
  sessionId: string,
  metadata?: Record<string, any>
): void => {
  const emoji = {
    created: '✅',
    updated: '🔄',
    deleted: '🗑️',
    expired: '⏰'
  };

  logger.info(`${emoji[operation]} Session ${operation}`, {
    sessionId,
    operation,
    ...metadata
  });
};

/**
 * Log analysis operation
 * 
 * @param stage - Analysis stage
 * @param sessionId - Session ID
 * @param metadata - Additional metadata
 */
export const logAnalysis = (
  stage: string,
  sessionId: string,
  metadata?: Record<string, any>
): void => {
  logger.info(`📊 Analysis: ${stage}`, {
    sessionId,
    stage,
    ...metadata
  });
};

/**
 * Log file operation
 * 
 * @param operation - Operation name
 * @param filename - Filename
 * @param metadata - Additional metadata
 */
export const logFile = (
  operation: 'uploaded' | 'parsed' | 'deleted' | 'saved',
  filename: string,
  metadata?: Record<string, any>
): void => {
  const emoji = {
    uploaded: '📤',
    parsed: '📝',
    deleted: '🗑️',
    saved: '💾'
  };

  logger.info(`${emoji[operation]} File ${operation}: ${filename}`, {
    filename,
    operation,
    ...metadata
  });
};

/**
 * Log RAG operation
 * 
 * @param operation - Operation name
 * @param sessionId - Session ID
 * @param metadata - Additional metadata
 */
export const logRag = (
  operation: 'session_created' | 'question_asked' | 'response_received' | 'error',
  sessionId: string,
  metadata?: Record<string, any>
): void => {
  const level = operation === 'error' ? 'error' : 'info';

  logger.log(level, `🤖 RAG: ${operation}`, {
    sessionId,
    operation,
    ...metadata
  });
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
  metadata?: Record<string, any>
): void => {
  const level = duration > 1000 ? 'warn' : 'debug';

  logger.log(level, `⚡ Performance: ${operation}`, {
    operation,
    duration: `${duration}ms`,
    ...metadata
  });
};

export { logger };
export default logger;