import { NextFunction, Request, Response } from 'express';
import { metrics } from '../services/metrics.service';

// Counts every answer and times it. It runs ahead of everything else, so answers from the rate
// limiter, the body parser and the 404 handler are counted too. A request the client abandons
// never finishes and is not counted.
export const recordMetrics = (req: Request, res: Response, next: NextFunction): void => {
    const started = process.hrtime.bigint();

    res.on('finish', () => {
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        metrics.recordHttp(req.method, req.originalUrl.split('?')[0], res.statusCode, seconds);
    });

    next();
};
