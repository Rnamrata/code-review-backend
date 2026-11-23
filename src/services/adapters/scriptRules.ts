// Rule cards for JavaScript and TypeScript (see ruleCards.ts for how cards work).
//
// ESLint already reports == (eqeqeq), HTML written from strings (XSS), eval and unused or `any`
// values, and the secret scan finds keys, so these cards cover what a linter without type
// information cannot see: mostly logic bugs around promises, loops and arrays. Written from the
// Google JavaScript Style Guide, MDN's guidelines and the OWASP cheat sheets.
import { LanguageRules, RuleCard, SLASH_COMMENT, matchesCode } from './ruleCards';

const matches = (pattern: RegExp) => matchesCode(pattern, SLASH_COMMENT);

// In priority order: when more cards match than fit, the first ones win.
export const SCRIPT_RULES: readonly RuleCard[] = [
    {
        id: 'unawaited-promise',
        applies: matches(/^(?![^\n]{0,200}\b(?:await|return)\b)[^\n]{0,200}\b(?:fetch|axios(?:\.\w+)?)\s*\(/m),
        hint: 'a promise (fetch or another async call) that is not awaited, so the next lines run before it finishes and its errors are lost - report it on the line of the call'
    },
    {
        id: 'unchecked-response',
        applies: (code) => /\bfetch\s*\(/.test(code) && !/\.ok\b|\.status\b/.test(code),
        hint: 'a fetch whose response is used without checking response.ok, so an HTTP error counts as success'
    },
    {
        id: 'off-by-one',
        applies: matches(/<=\s*[\w.]{1,60}\.length\b/),
        hint: 'a loop that runs while i <= length, one step past the last element, so it reads undefined - report it on the line of the loop'
    },
    {
        id: 'splice-in-loop',
        applies: matches(/\bfor\s*\([^)\n]{0,120}\+\+[^)\n]{0,20}\)[^]{0,300}?\.splice\s*\(/),
        hint: 'items removed with splice inside a loop that counts up, which skips the item after each one removed'
    },
    {
        id: 'divide-by-count',
        applies: matches(/\/\s*(?:[\w.]{1,60}\.length\b|(?:count|people|n|size|total|parts|divisor)\b)/),
        hint: 'a division by a length, count or argument that can be zero, which gives Infinity or NaN instead of an error'
    },
    {
        id: 'sort-in-place',
        applies: matches(/\breturn\s+this\.\w+\.sort\s*\(|\b\w+\s*=\s*this\.\w+\.sort\s*\(/),
        hint: 'sort() reorders the array in place, so a method meant to return a sorted copy changes the object\'s own data (copy it first: [...items].sort())'
    },
    {
        id: 'state-changed-before-await',
        applies: (code) => /\basync\b/.test(code) && /\bthis\.\w+\s*=\s*(?:\[\]|\{\}|null|0)\s*;/.test(code),
        hint: 'state cleared or changed before the async work it depends on has finished or succeeded, so a failure loses it'
    },
    {
        id: 'json-parse',
        applies: matches(/\bJSON\.parse\s*\(/),
        hint: 'JSON.parse on data from outside without try/catch, so bad input throws and stops the caller'
    },
    {
        id: 'token-in-storage',
        applies: matches(/\b(?:localStorage|sessionStorage)\.setItem\s*\([^)\n]{0,80}(?:token|jwt|session|auth)/i),
        hint: 'a token kept in localStorage or sessionStorage, where any script on the page (or an XSS bug) can read it'
    }
];

// No fallback: with general reminders a correct file got invented findings (8 against 3).
export const SCRIPT_GENERAL_IDS: string[] = [];

export const SCRIPT: LanguageRules = { name: 'JavaScript/TypeScript', cards: SCRIPT_RULES, generalIds: SCRIPT_GENERAL_IDS };
