import { Request, Response } from 'express';
import { HTTP_STATUS } from '../constants/httpStatus';
import { ReviewRequest } from '../models';
import { ReviewBody } from '../schemas/review.schema';
import { reviewCode } from '../services/reviewOrchestrator.service';
import { Validator } from '../utils/validator.util';
import { createChildLogger } from '../utils/logger.util';
import { normalizeLanguage } from '../constants/fileTypes';

// By the time a request gets here, attachRequestId has given it an id and validateReview has
// checked the body, so both can be relied on.
export const review = async (req: Request, res: Response): Promise<void> => {
    const requestId: string = res.locals.requestId;
    const log = createChildLogger({ requestId });

    const { filename, language, code } = req.body as ReviewBody;
    const normalized = normalizeLanguage(language, filename);

    const request: ReviewRequest = {
        filename: filename.trim(),
        safeFilename: Validator.sanitizeFilename(filename),
        language: normalized ?? language.trim().toLowerCase(),
        code,
        requestId
    };

    log.info('Review requested', { filename: request.filename, language: request.language });

    const result = await reviewCode(request);
    res.status(HTTP_STATUS.OK).json(result);
};