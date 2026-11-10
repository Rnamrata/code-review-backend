export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type FindingSource = 'eslint' | 'ruff' | 'llm';

export interface Finding {
    file: string;
    line: number;
    message: string;
    severity: Severity;
    category?: string;
    source?: FindingSource;
    suggestion?: string;
}

export const SEVERITY_ORDER: Record<Severity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4
};

// Own keys only: a plain `in` check would accept "toString" and "constructor".
export function isSeverity(value: unknown): value is Severity {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SEVERITY_ORDER, value);
}