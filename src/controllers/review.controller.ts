import { Request, Response } from 'express';
import { appConfig } from '../config/app.config';
import { HTTP_STATUS } from '../constants/httpStatus';
import { ReviewRequest } from '../models';
import { reviewCode } from '../services/reviewOrchestrator.service';
import { errorResponse } from '../utils/responseFormatter.util';
import { Validator } from '../utils/validator.util';
import { logger } from '../utils/logger.util';
import { normalizeLanguage } from '../constants/fileTypes';

const isNotEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length >0;

export const review = async (req: Request, res: Response): Promise<void> => {
    const { filename, language, code } = req.body ?? {};

    if (!isNotEmptyString(filename) || !isNotEmptyString(language) || typeof code !== 'string') {
        res.status(HTTP_STATUS.BAD_REQUEST).json(
            errorResponse('Invalid request', 'Body must be JSON: { filename, language, code } (all strings)')
        );
        return;
    }

    if (!Validator.isValidFileExtension(filename)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json(
            errorResponse('Unsupported file type', `Allowed extensions: ${appConfig.allowedExtensions.join(', ')}`)
        );
        return;
    }

    if (!Validator.isValidFileSize(Buffer.byteLength(code, 'utf8'))) {
        res.status(HTTP_STATUS.BAD_REQUEST).json(
            errorResponse('Invalid code size', 'Code must be non-empty and within the configured size limits')
        );
        return;
    }

    const normalized = normalizeLanguage(language, filename);

    const request: ReviewRequest = {
        filename: filename.trim(),
        safeFilename: Validator.sanitizeFilename(filename),
        language: normalized ?? language.trim().toLowerCase(),
        code
    };

    logger.info('Review requested', {filename: request.filename, language: request.language});

    const result = await reviewCode(request);
    res.status(HTTP_STATUS.OK).json(result);
}