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

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json(errorResponse(
      'File too large',
      `Maximum file size is ${process.env.MAX_FILE_SIZE_MB || 1}MB`
    ));
    return;
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    res.status(400).json(errorResponse(
      'Unexpected file field',
      'Only single file upload is allowed with field name "file"'
    ));
    return;
  }

  // Custom errors
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json(errorResponse(
    message,
    process.env.NODE_ENV === 'development' ? err.stack : undefined
  ));
};