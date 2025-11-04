import path from 'path';
import { appConfig } from '../config/app.config';

export class Validator {
  static isValidSessionId(sessionId: string): boolean {
    // UUID v4 format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(sessionId);
  }

  static isValidFileExtension(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return appConfig.allowedExtensions.includes(ext);
  }

  static isValidFileSize(size: number): boolean {
    const maxSize = appConfig.maxFileSizeMB * 1024 * 1024;
    return size > 0 && size <= maxSize;
  }

  static sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  }
}