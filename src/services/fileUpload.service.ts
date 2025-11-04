import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { appConfig } from '../config/app.config';
import { logger, logFile } from '../utils/logger.util';
import { Validator } from '../utils/validator.util';
import { FILE_EXTENSION_MAP } from '../constants/fileTypes';
import { SessionManagerService } from './sessionManager.service';

export interface UpdateResult {
    sessionID: string;
    fileName: string;
    originalFilename: string;
    language: string;
    filePath: string;
    fileSize: number;
}

export class FileUploadService {
    public static async processUpload(
        file: Express.Multer.File,
        language?: string
    ): Promise<UpdateResult> {
        logger.info('Processing file upload', {
            filename: file.originalname,
            size: file.size,
            mimetype: file.mimetype
        });

        try {
            this._validateFile(file);

            const detectLanguage = language || this._detectLanguage(file.originalname);
            const sessionID = uuidv4();
            const savedPath = await this._saveFile(file, sessionID);

            await SessionManagerService.createSession({
                sessionID,
                fileName: file.originalname,
                originalFilename: file.originalname,
                language: detectLanguage,
                filePath: savedPath,
                fileSize: file.size
            });

            logFile('uploaded', file.originalname, {
                sessionID,
                savedPath,
                size: file.size,
                language: detectLanguage
            });

            return { 
                sessionID,
                fileName: file.originalname,
                originalFilename: file.originalname,
                language: detectLanguage,
                filePath: savedPath,
                fileSize: file.size
            };
        } catch (error) {
            logger.error('File upload failed', {
                filename: file.originalname,
                error: (error as Error).message,
                stack: (error as Error).stack
            });
            throw error;
        }
    }

    private static _validateFile(file: Express.Multer.File): void {
        if(!file) {
            throw new Error('No file provided');
        }

        if(!Validator.isValidFileExtension(file.originalname)) {
            throw new Error(
                        `File type not allowed. Allowed: ${appConfig.allowedExtensions.join(', ')}`
            );
        }

        if(!Validator.isValidFileSize(file.size)) {
            throw new Error(`File size exceeds limit of ${appConfig.maxFileSizeMB}MB`);
        }
    }

    private static _detectLanguage(filename: string): string {
        const ext = path.extname(filename).toLowerCase();
        return FILE_EXTENSION_MAP[ext] || 'unknown';
    }

    private static async _saveFile(
        file: Express.Multer.File,
        sessionID: string
    ): Promise<string> {
        const uploadDir = appConfig.uploadDirectory;
        await fs.mkdir(uploadDir, { recursive: true });

        const safeFilename = this._generateSafeFilename(file.originalname, sessionID);
        const filePath = path.join(uploadDir, safeFilename);

        if(file.buffer) {
            await fs.writeFile(filePath, file.buffer)
        } else if(file.path) {
            await fs.copyFile(file.path, filePath);
            await fs.unlink(file.path);
        } else {
            throw new Error('File has no buffer or path');
        }

        return filePath;
    }

    private static _generateSafeFilename(originalFilename: string, sessionID: string): string {
        const safeName = Validator.sanitizeFilename(originalFilename);
        const shortSessionID = sessionID.split('-')[0];
        return `${shortSessionID}_${safeName}`;
    }
}