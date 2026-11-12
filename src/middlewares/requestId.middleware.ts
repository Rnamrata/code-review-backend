import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

// A caller may send its own id to follow one review across services.
// Only a short, plain value is accepted, so it is safe to log and echo back.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

// Gives every request an id, sends it back in the X-Request-Id header and keeps it in
// res.locals.requestId. It runs before validation, so even a rejected request carries it.
export const attachRequestId = (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.get('X-Request-Id');
    const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();

    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
};