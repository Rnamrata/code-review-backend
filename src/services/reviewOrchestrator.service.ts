import { Analyzer, ReviewRequest, ReviewResponse, ReviewWarning } from '../models/review.model';
import { logger } from '../utils/logger.util';
import { mergeFindings} from './findingsMerger.service';
import { buildSummary } from './reviewSummary.service';

// Analyzers get registered here as you build them (eslint, ruff, llm).
const analyzers: Analyzer[] = [];

// Stay well under the chatbot's 60 s timeout.
const ANALYZER_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function reviewCode(request: ReviewRequest): Promise<ReviewResponse> {
    const active = analyzers.filter((a) => a.supports(request.language));

    // Nothing can review this language: say so instead of returning a misleading clean result.
    if (active.length === 0) {
        const message = `No analyzers support this language "${request.language}"`;
        logger.warn(message, { filename: request.filename });

        return {
            findings: [],
            warnings: [{ source: 'orchestrator', message }],
            summary: buildSummary([])
        };
    }

    const results = await Promise.allSettled(
        active.map((a) => withTimeout(a.analyze(request), ANALYZER_TIMEOUT_MS, a.name))
    );

    const lists: ReviewResponse['findings'][] = [];
    const warnings: ReviewWarning[] = [];

    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            lists.push(result.value.map((finding) => ({ ...finding, file:request.filename })));
        } else {
            logger.warn('Analyzer failed', { analyzer: active[index].name, error: String(result.reason)});
            warnings.push({
                source: active[index].name,
                message: String(result.reason?.message ?? result.reason)
            });
        }
    });

    const findings = mergeFindings(lists);
    return {
        findings,
        warnings,
        summary: buildSummary(findings)
    };
}

