import { Finding, SEVERITY_ORDER } from '../models/finding';

// Linters are more precise than the LLM, so they win ties.
const SOURCE_PRIORITY: Record<string, number> = {
    eslint: 0,
    ruff: 0,
    llm: 1
};

const priorityOf = (f: Finding) => SOURCE_PRIORITY[f.source ?? 'llm'] ?? 1;

// A model often points one line away from where a linter points at the same problem.
const LINE_TOLERANCE = 1;

// On the same line a missing category is no obstacle. One line apart there is less to go on,
// so both categories must be known and equal (a hard-coded token next to an unused variable
// are two different problems).
const categoriesFit = (a: Finding, b: Finding): boolean =>
    a.category && b.category ? a.category === b.category : a.line === b.line;

// The same issue means: same file, found by DIFFERENT analyzers, on the same line or one
// line apart, with fitting categories. Findings from one analyzer are never merged,
// even on the same line, because they are separate rules.
const isSameIssue = (a: Finding, b: Finding): boolean =>
    a.file === b.file &&
    a.source !== b.source &&
    Math.abs(a.line - b.line) <= LINE_TOLERANCE &&
    categoriesFit(a, b);

// Keep the more precise source's wording, line and fix text. A linter's severity is
// calibrated and a model's is a guess, so a linter's rating stands; between equals the
// higher one wins.
function combine(a: Finding, b: Finding): Finding {
    const [winner, loser] = priorityOf(b) < priorityOf(a) ? [b, a] : [a, b];
    const severity =
        priorityOf(a) === priorityOf(b)
            ? SEVERITY_ORDER[a.severity] <= SEVERITY_ORDER[b.severity] ? a.severity : b.severity
            : winner.severity;
    return { ...winner, severity, suggestion: winner.suggestion ?? loser.suggestion };
}

// Of the findings that could be the same issue, the one on the closest line.
function closestMatch(merged: Finding[], matched: Set<number>, finding: Finding): number {
    let best = -1;
    let bestDistance = Infinity;

    merged.forEach((existing, index) => {
        if (matched.has(index) || !isSameIssue(existing, finding)) return;
        const distance = Math.abs(existing.line - finding.line);
        if (distance < bestDistance) {
            best = index;
            bestDistance = distance;
        }
    });
    return best;
}

export function mergeFindings(lists: Finding[][]): Finding[] {
    const merged: Finding[] = [];

    // One list per analyzer. Within a list nothing is merged, so each list is
    // matched against what earlier lists produced.
    for (const list of lists) {
        const matched = new Set<number>(); // indexes already absorbed by this list

        for (const finding of list) {
            const index = closestMatch(merged, matched, finding);

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