import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.util';
import { errorResponse } from '../utils/responseFormatter.util';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  logger.error('Error handler caught error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  // Custom errors
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json(errorResponse(
    message,
    process.env.NODE_ENV === 'development' ? err.stack : undefined
  ));
};