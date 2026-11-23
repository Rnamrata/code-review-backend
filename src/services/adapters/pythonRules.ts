// Rule cards for Python (see ruleCards.ts for how cards work).
//
// Ruff already reports SQL built from strings (S608), eval (S307), requests without a timeout
// (S113), mutable default arguments (B006), bare except (E722) and == None (E711), and the
// secret scan finds keys and passwords, so these cards cover what neither can see: mostly
// logic bugs and resources that are never released. Written from PEP 8 and the OWASP cheat
// sheets (error handling, input validation).
import { HASH_COMMENT, LanguageRules, RuleCard, matchesCode } from './ruleCards';

const matches = (pattern: RegExp) => matchesCode(pattern, HASH_COMMENT);

// In priority order: when more cards match than fit, the first ones win.
export const PYTHON_RULES: readonly RuleCard[] = [
    {
        id: 'divide-by-length',
        applies: matches(/\/\s*len\s*\(/),
        hint: 'a division by len(...) of a list or string that can be empty, which raises ZeroDivisionError - report it on the line of the division'
    },
    {
        id: 'off-by-one',
        applies: matches(/[\w)\]]\s*\+\s*1\s*[\]:]|<=\s*len\s*\(|^[ \t]*(?:end|stop|last|upper|limit|hi|high)\w{0,20}\s*=[^\n]{0,80}\+\s*1[ \t]*$/m),
        hint: 'a range, slice or index that goes one past the end (an extra + 1, or <= len(...)), so one item too many is taken or an IndexError is raised'
    },
    {
        id: 'unclosed-file',
        applies: matches(/^(?![ \t]*with\b)[^#\n]{0,200}\b(?:open|sqlite3\.connect|socket\.socket|urlopen)\s*\(/m),
        hint: 'a file, connection or socket opened outside a with block and never closed - report it on the line that opens it'
    },
    {
        id: 'swallowed-exception',
        applies: matches(/^[ \t]*except\b[^:\n]{0,80}:[ \t]*(?:\n[ \t]*)?(?:pass|return\s+None|return\b\s*$|continue|print\s*\()/m),
        hint: 'an exception caught and ignored (pass, return None, continue or only a print) instead of handled or re-raised - report it on the line of the except'
    },
    {
        id: 'unchecked-response',
        applies: (code) => /\brequests\.\w+\s*\(|\burlopen\s*\(/.test(code) && !/raise_for_status\s*\(/.test(code),
        hint: 'an HTTP call whose failure (a status other than 2xx) is not handled, so the code goes on as if it worked or silently returns None'
    },
    {
        id: 'float-equality',
        applies: matches(/\b\w{0,30}(?:total|price|amount|cost|balance|sum|average|rate)\w{0,30}\s*(?:==|!=)\s*\w/i),
        hint: 'money or other decimal amounts compared with == (floating-point sums rarely match exactly; use math.isclose, or Decimal for money)'
    },
    {
        id: 'none-result-used',
        applies: matches(/\.get\s*\([^()\n]{1,60}\)\s*[.[]/),
        hint: 'the result of dict.get (None for a missing key) used straight away, with an attribute or an index, without checking for None'
    },
    {
        id: 'shared-default-state',
        applies: matches(/^[ \t]*(?:cache|_cache|registry|instances|sessions)\s*=\s*(?:\{\}|\[\]|dict\(\)|list\(\))/m),
        hint: 'module-level or class-level mutable state (a dict or list) shared by every caller and every thread, which grows forever or mixes callers\' data'
    }
];

// No fallback: with general reminders a correct file got invented findings (8 on one file).
export const PYTHON_GENERAL_IDS: string[] = [];

export const PYTHON: LanguageRules = { name: 'Python', cards: PYTHON_RULES, generalIds: PYTHON_GENERAL_IDS };
