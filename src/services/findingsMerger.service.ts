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

// What a message is about. A linter and the model often file the same problem under
// different categories (Ruff's bare `except` is maintainability, the model calls a broad
// except security), so naming the same topic counts as fitting. Kept to topics whose
// words are unambiguous.
const TOPICS: RegExp[] = [
    /\bexcept\b|\bexceptions?\b|\bcatch\b/i,
    /\bsql\b/i,
    /\beval\b|\bexec\b/i,
    /\bsecrets?\b|\bpasswords?\b|\bapi[ _-]?keys?\b|\bcredentials?\b/i,
    /\btimeouts?\b/i,
    /\bmutable\b/i,
    /\bnull\b|\bnone\b/i,
    /\brandom\b/i
];

const sameTopic = (a: Finding, b: Finding): boolean =>
    TOPICS.some((topic) => topic.test(a.message) && topic.test(b.message));

// On the same line a missing category is no obstacle. One line apart there is less to go on,
// so both categories must be known and equal (a hard-coded token next to an unused variable
// are two different problems). Either way, messages about the same topic fit.
const categoriesFit = (a: Finding, b: Finding): boolean =>
    sameTopic(a, b) || (a.category && b.category ? a.category === b.category : a.line === b.line);

// The same issue means: same file, found by DIFFERENT analyzers, on the same line or one
// line apart, with fitting categories. Findings from one analyzer are only merged when
// they are copies (see withoutCopies); otherwise they are separate rules.
const isSameIssue = (a: Finding, b: Finding): boolean =>
    a.file === b.file &&
    a.source !== b.source &&
    Math.abs(a.line - b.line) <= LINE_TOLERANCE &&
    categoriesFit(a, b);

const normalize = (message: string): string => message.trim().replace(/\s+/g, ' ').toLowerCase();

// One analyzer reporting the same message on the same line twice says nothing new. The model
// does this when it invents a second copy of a line: its quoted text then only exists on the
// first, so both findings end up there.
function withoutCopies(list: Finding[]): Finding[] {
    const seen = new Set<string>();
    return list.filter((f) => {
        const key = `${f.file}\u0000${f.line}\u0000${normalize(f.message)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

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

    // One list per analyzer. Within a list only copies are dropped, so each list is
    // matched against what earlier lists produced.
    for (const list of lists) {
        const matched = new Set<number>(); // indexes already absorbed by this list

        for (const finding of withoutCopies(list)) {
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