// Rule cards: short reminders of problems a small model tends to overlook, each with a cheap
// check on the submitted code. Only the cards whose check matches go into the prompt, so the
// model is told what to look for in this file and is not nudged towards problems that cannot
// be there. (A long list of reminders for every file made the model invent findings.)
//
// The checks only choose between texts written here. Nothing from the submitted code is copied
// into the prompt, so the code cannot add instructions through them.
//
// The cards for each language are in javaRules.ts, pythonRules.ts and scriptRules.ts.

export interface RuleCard {
    // Short name, used in the debug log so it is clear which cards a review got.
    id: string;
    // Does the card apply to this code? Plain patterns, kept simple and bounded so that a large
    // file cannot make one of them slow.
    applies: (code: string) => boolean;
    // One line, phrased as a thing to look for.
    hint: string;
}

export interface LanguageRules {
    // How the hint names the language: "Also check for these Python problems:"
    name: string;
    // In priority order: when more cards match than fit, the first ones win.
    cards: readonly RuleCard[];
    // Given when no card matches. Without any hint the model invented findings on a correct
    // file (12 in four runs, against 0 with the reminders).
    generalIds: readonly string[];
}

// More cards than this made the model pad its answer with weak findings.
export const MAX_RULES = 6;

export const matches = (pattern: RegExp) => (code: string) => pattern.test(code);

// The same, ignoring whole-line comments: a card is about code, not about what a comment says
export const matchesCode = (pattern: RegExp, comment: RegExp) => (code: string) => pattern.test(code.replace(comment, ''));
export const SLASH_COMMENT = /^[ \t]*(?:\/\/|\/?\*).*$/gm;
export const HASH_COMMENT = /^[ \t]*#.*$/gm;

export function pickCards(code: string, rules: LanguageRules, max: number = MAX_RULES): RuleCard[] {
    const picked = rules.cards.filter((card) => card.applies(code)).slice(0, max);
    return picked.length > 0 ? picked : rules.cards.filter((card) => rules.generalIds.includes(card.id));
}

export function buildHint(name: string, selected: readonly RuleCard[]): string | undefined {
    if (selected.length === 0) return undefined;
    return [`Also check for these ${name} problems:`, ...selected.map((card) => `- ${card.hint}`)].join('\n');
}
