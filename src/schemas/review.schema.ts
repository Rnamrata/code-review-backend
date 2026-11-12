import { z } from 'zod';
import { appConfig } from '../config/app.config';
import { Validator } from '../utils/validator.util';

// What a caller of POST /review has to send.
export interface ReviewBody {
    filename: string;
    language: string;
    code: string;
}

// What is reported back when the body is not acceptable: the `error` and `message` of the 400.
export interface BodyProblem {
    error: string;
    message: string;
}

const INVALID_BODY: BodyProblem = {
    error: 'Invalid request',
    message: 'Body must be JSON: { filename, language, code } (all strings)'
};

// The file name and the language have to say something; blank text does not count.
const nonBlank = z.string().refine((value) => value.trim().length > 0);

// The rules run in this order and the first one that fails is the one reported:
// the shape of the body, then the file extension, then the size of the code.
const reviewBodySchema = z
    .object({
        filename: nonBlank,
        language: nonBlank,
        code: z.string()
    })
    .superRefine((body, ctx) => {
        if (!Validator.isValidFileExtension(body.filename)) {
            ctx.addIssue({
                code: 'custom',
                message: 'Unsupported file type',
                params: { detail: `Allowed extensions: ${appConfig.allowedExtensions.join(', ')}` }
            });
            return;
        }

        if (!Validator.isValidFileSize(Buffer.byteLength(body.code, 'utf8'))) {
            ctx.addIssue({
                code: 'custom',
                message: 'Invalid code size',
                params: { detail: 'Code must be non-empty and within the configured size limits' }
            });
        }
    });

export type ReviewBodyResult = { ok: true; body: ReviewBody } | { ok: false; problem: BodyProblem };

// Checks a request body. On success the body holds only the three known fields.
export function parseReviewBody(input: unknown): ReviewBodyResult {
    const result = reviewBodySchema.safeParse(input);
    if (result.success) return { ok: true, body: result.data };

    const issue = result.error.issues[0];
    const detail = issue.code === 'custom' ? (issue.params as { detail?: string } | undefined)?.detail : undefined;

    // A rule that came with its own explanation reports it; anything else is a wrong shape.
    return detail ? { ok: false, problem: { error: issue.message, message: detail } } : { ok: false, problem: INVALID_BODY };
}