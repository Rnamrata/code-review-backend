import { Finding } from '../models/finding';
import { Analyzer, ReviewRequest, ReviewResponse, ReviewWarning } from '../models/review.model';
import { createChildLogger, logPerformance } from '../utils/logger.util';
import { mergeFindings } from './findingsMerger.service';
import { buildSummary } from './reviewSummary.service';
import { eslintAdapter } from './adapters/eslint.adapter';
import { ruffAdapter } from './adapters/ruff.adapter';
import { llmAdapter } from './adapters/llm.adapter';

// Analyzers get registered here as you build them (eslint, ruff, llm).
const analyzers: Analyzer[] = [eslintAdapter, ruffAdapter, llmAdapter];

// Used by any analyzer that does not declare its own `timeoutMs`.
// Stays well under the chatbot's 60 s timeout.
const DEFAULT_ANALYZER_TIMEOUT_MS = 45_000;

// Timings above these are logged as warnings.
const SLOW_ANALYZER_MS = 10_000;
const SLOW_REVIEW_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string, onTimeout: () => void): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            onTimeout();
            reject(new Error(`${label} timed out after ${ms} ms`));
        }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// The analyzer is started immediately, so all of them run in parallel. Because this
// is an async function, an analyzer that throws before it returns a promise is
// turned into a rejection too, and ends up as a warning like any other failure.
async function runAnalyzer(analyzer: Analyzer, request: ReviewRequest): Promise<Finding[]> {
    const controller = new AbortController();
    const timeoutMs = analyzer.timeoutMs ?? DEFAULT_ANALYZER_TIMEOUT_MS;
    const started = Date.now();

    try {
        return await withTimeout(
            analyzer.analyze(request, controller.signal),
            timeoutMs,
            analyzer.name,
            () => controller.abort() // tell the analyzer to stop, not just stop waiting
        );
    } finally {
        logPerformance(
            `analyzer ${analyzer.name}`,
            Date.now() - started,
            { requestId: request.requestId },
            SLOW_ANALYZER_MS
        );
    }
}

export async function reviewCode(request: ReviewRequest): Promise<ReviewResponse> {
    const log = createChildLogger({ requestId: request.requestId });
    const reviewStarted = Date.now();
    const active = analyzers.filter((a) => a.supports(request.language));

    // Nothing can review this language: say so instead of returning a misleading clean result.
    if (active.length === 0) {
        const message = `No analyzers support this language "${request.language}"`;
        log.warn(message, { filename: request.filename });

        return {
            findings: [],
            warnings: [{ source: 'orchestrator', message }],
            summary: buildSummary([])
        };
    }

    const results = await Promise.allSettled(active.map((a) => runAnalyzer(a, request)));

    const lists: ReviewResponse['findings'][] = [];
    const warnings: ReviewWarning[] = [];

    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            lists.push(result.value.map((finding) => ({ ...finding, file: request.filename })));
        } else {
            log.warn('Analyzer failed', { analyzer: active[index].name, error: String(result.reason) });
            warnings.push({
                source: active[index].name,
                message: String(result.reason?.message ?? result.reason)
            });
        }
    });

    const findings = mergeFindings(lists);

    logPerformance(
        'review',
        Date.now() - reviewStarted,
        { requestId: request.requestId, analyzers: active.length, findings: findings.length },
        SLOW_REVIEW_MS
    );

    return {
        findings,
        warnings,
        summary: buildSummary(findings)
    };
}