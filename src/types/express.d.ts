import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      file?: Express.Multer.File;      // Single file
      files?: Express.Multer.File[];   // Multiple files (array)
    }
  }
}

export {};