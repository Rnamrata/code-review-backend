import { Finding, SEVERITY_ORDER } from '../models/finding';

// Linters are more precise than the LLM, so they win ties.
const SOURCE_PRIORITY: Record<string, number> = {
    eslint: 0,
    ruff: 0,
    llm: 1
};

const priorityOf = (f: Finding) => SOURCE_PRIORITY[f.source ?? 'llm'] ?? 1;

// The same issue means: same file and line, found by DIFFERENT analyzers,
// with compatible categories. Findings from one analyzer are never merged,
// even on the same line, because they are separate rules.
const isSameIssue = (a: Finding, b: Finding): boolean =>
    a.file === b.file &&
    a.line === b.line &&
    a.source !== b.source &&
    (!a.category || !b.category || a.category === b.category);

// Keep the more precise source's wording, the higher severity, and any fix text.
function combine(a: Finding, b: Finding): Finding {
    const [winner, loser] = priorityOf(b) < priorityOf(a) ? [b, a] : [a, b];
    const severity = SEVERITY_ORDER[a.severity] <= SEVERITY_ORDER[b.severity] ? a.severity : b.severity;
    return { ...winner, severity, suggestion: winner.suggestion ?? loser.suggestion };
}

export function mergeFindings(lists: Finding[][]): Finding[] {
    const merged: Finding[] = [];

    // One list per analyzer. Within a list nothing is merged, so each list is
    // matched against what earlier lists produced.
    for (const list of lists) {
        const matched = new Set<number>(); // indexes already absorbed by this list

        for (const finding of list) {
            const index = merged.findIndex(
                (existing, i) => !matched.has(i) && isSameIssue(existing, finding)
            );

            if (index === -1) {
                merged.push(finding);
                continue;
            }

            matched.add(index);
            merged[index] = combine(merged[index], finding);
        }
    }

    return merged.sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.line - b.line
    );
}