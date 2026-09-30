import path from 'path';
import { appConfig } from '../config/app.config';

export class Validator {
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