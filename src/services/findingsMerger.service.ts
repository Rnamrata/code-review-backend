import {Finding, SEVERITY_ORDER} from '../models/finding';

// Linters are more precise than the LLM, so they win ties.
const SOURCE_PRIORITY: Record<string, number> = {
    eslint: 0,
    ruff: 0,
    llm: 1
};

const priorityOf = (f: Finding) => SOURCE_PRIORITY[f.source ?? 'llm'] ?? 1;

// Two findings are "the same issue" when they hit the same line and category.
// This heuristic is deliberately simple; tune it once you see real output.

const keyOf = (f:Finding): string => `${f.file}:${f.line}:${f.category ?? ''}`;

export function mergeFindings(lists: Finding[][]): Finding[] {
    const byKey = new Map<string, Finding>();

    for (const finding of lists.flat()) {
        const key = keyOf(finding);
        const existing = byKey.get(key);

        if (!existing) {
            byKey.set(key, finding);
            continue;
        }

        // Keep the more precise source, but carry over a suggestion the other one had.
        const [winner, loser] = priorityOf(finding) < priorityOf(existing) ? [finding, existing] : [existing, finding];
        byKey.set(key, { ...winner, suggestion: winner.suggestion ?? loser.suggestion });
    }
    return [...byKey.values()].sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.line - b.line
    );
}

