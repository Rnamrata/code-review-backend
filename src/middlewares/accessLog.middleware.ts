import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.util';

// Probes and scrapes arrive every few seconds. They are logged at debug level so they do not
// drown out the reviews.
const QUIET_PATHS = new Set(['/health', '/ready', '/metrics']);

// One log line per answer, with fields a log tool can filter on (status, durationMs, requestId).
// It replaces morgan, whose lines were plain text. The query string is left out of the path, and
// the body is never logged: it is somebody's code.
export const accessLog = (req: Request, res: Response, next: NextFunction): void => {
    const started = process.hrtime.bigint();

    res.on('finish', () => {
        const path = req.originalUrl.split('?')[0];
        const level = QUIET_PATHS.has(path) ? 'debug' : 'info';

        logger.log(level, 'HTTP request', {
            requestId: res.locals.requestId, // only /review has one; the field is left out elsewhere
            method: req.method,
            path,
            status: res.statusCode,
            durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1e4) / 100
        });
    });

    next();
};
