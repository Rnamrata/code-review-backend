import { Request, Response, NextFunction } from 'express';
import { appConfig } from '../config/app.config';
import { logger } from '../utils/logger.util';
import { errorResponse } from '../utils/responseFormatter.util';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // The full error, stack included, always goes to the server log.
  logger.error('Error handler caught error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  const isDevelopment = appConfig.nodeEnv === 'development';
  const statusCode = err.statusCode || err.status || 500;
  const isServerError = statusCode >= 500;

  // Client errors (400, 413, ...) describe the caller's own mistake, so their
  // message is safe to return. Server errors may contain internals, so outside
  // development they get a generic message.
  const message =
    !isServerError || isDevelopment
      ? err.message || 'Internal server error'
      : 'Internal server error';

  res.status(statusCode).json({
    ...errorResponse(message),
    // Own field, development only. Never mixed into `message`.
    ...(isDevelopment && { stack: err.stack })
  });
};