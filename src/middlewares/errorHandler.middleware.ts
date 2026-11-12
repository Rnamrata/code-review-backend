import { Request, Response, NextFunction } from 'express';
import { appConfig } from '../config/app.config';
import { logError, logger } from '../utils/logger.util';
import { errorResponse } from '../utils/responseFormatter.util';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const isDevelopment = appConfig.nodeEnv === 'development';
  const statusCode = err.statusCode || err.status || 500;
  const isServerError = statusCode >= 500;

  // A server error is logged in full, stack included, whatever the environment. A client
  // mistake (bad JSON, a body that is too large) is not a fault of the service, so it is
  // a short warning without a stack.
  // The request id ties this line to the access-log line and the other lines of the same request.
  // Only /review has one; on other routes the field is simply empty.
  const requestId = res.locals?.requestId;

  if (isServerError) {
    logError(err, { path: req.path, method: req.method, status: statusCode, requestId });
  } else {
    logger.warn('Client error', { error: err.message, path: req.path, method: req.method, status: statusCode, requestId });
  }

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