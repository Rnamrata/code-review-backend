import { NextFunction, Request, Response } from 'express';
import { HTTP_STATUS } from '../constants/httpStatus';
import { parseReviewBody } from '../schemas/review.schema';
import { logSecurity } from '../utils/logger.util';
import { errorResponse } from '../utils/responseFormatter.util';

// Lets a request through only when its body is acceptable. Otherwise it answers 400 with the
// reason and logs the rejection. After it, req.body holds just filename, language and code.
export const validateReview = (req: Request, res: Response, next: NextFunction): void => {
    const parsed = parseReviewBody(req.body);

    if (!parsed.ok) {
        logSecurity('invalid_request', {
            requestId: res.locals.requestId,
            ip: req.ip,
            reason: parsed.problem.error
        });
        res.status(HTTP_STATUS.BAD_REQUEST).json(errorResponse(parsed.problem.error, parsed.problem.message));
        return;
    }

    req.body = parsed.body;
    next();
};