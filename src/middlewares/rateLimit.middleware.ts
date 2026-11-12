import { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { logSecurity } from '../utils/logger.util';
import { errorResponse } from '../utils/responseFormatter.util';
import { metrics } from '../services/metrics.service';

export interface RateLimitOptions {
    windowMs: number;
    max: number;
}

// Limits how often one client (by IP address) may start a review. Every review can cost
// seconds of CPU and model time, so an unthrottled caller could keep the service busy.
export function createRateLimiter({ windowMs, max }: RateLimitOptions) {
    return rateLimit({
        windowMs,
        limit: max,
        standardHeaders: 'draft-7', // RateLimit and Retry-After headers
        legacyHeaders: false,
        handler: (req: Request, res: Response) => {
            metrics.recordRateLimited();
            logSecurity('rate_limit_exceeded', {
                ip: req.ip,
                method: req.method,
                path: req.originalUrl,
                requestId: res.getHeader('X-Request-Id')
            });

            res.status(429).json(errorResponse('Too many requests', 'Too many review requests. Try again later.'));
        }
    });
}