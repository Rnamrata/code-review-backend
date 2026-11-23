import {Finding, FindingSource, Severity} from './finding';

export interface ReviewRequest {
    filename: string;       // exactly what the chatbot sent (trimmed); used in findings
    safeFilename: string;   // sanitized; only for temp files or paths on disk
    language: string;
    code: string;
    requestId?: string; 
}

// Non-fatal problems: one analyzer failed or timed out, but the review still returned.
export interface ReviewWarning {
    source: FindingSource | 'orchestrator';
    message: string;
}

export interface ReviewSummary {
    total: number;
    bySeverity: Record<Severity, number>;
    bySource: Partial<Record<FindingSource, number>>;
    byCategory: Record<string, number>;
}

// The chatbot only reads `findings`; warnings and summary are extras it ignores.
export interface ReviewResponse {
    findings: Finding[];
    warnings: ReviewWarning[];
    summary: ReviewSummary;
}

// Every analyzer (ESLint, Ruff, LLM) implements this same shape.
export interface Analyzer {
    name: FindingSource;
    timeoutMs?: number;
    // Only runs next to another analyzer. On its own (the secret scan for a language whose
    // linter or AI reviewer is off) a clean result would read as "no issues found".
    supplementary?: boolean;
    supports(language: string): boolean;
    analyze(request: ReviewRequest, signal?: AbortSignal): Promise<Finding[]>;
}

