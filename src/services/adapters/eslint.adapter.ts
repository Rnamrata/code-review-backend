import path from "path";
import globals from 'globals';
import { ESLint, Linter} from 'eslint';
import js from "@eslint/js";
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import { SUPPORTED_LANGUAGES } from '../../constants/fileTypes';
import { Finding, Severity } from '../../models/finding';
import { Analyzer, ReviewRequest } from '../../models/review.model';
import { logger } from '../../utils/logger.util';


const XSS_ADVICE = 'text from a user can run as script (XSS). Set textContent, or build the elements, instead';
const XSS_SINKS = [
    {
        selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
        message: `HTML is set from a string with innerHTML or outerHTML: ${XSS_ADVICE}.`
    },
    {
        selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
        message: `HTML is inserted from a string with insertAdjacentHTML: ${XSS_ADVICE}.`
    },
    {
        selector: "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]",
        message: `HTML is written from a string with document.write: ${XSS_ADVICE}.`
    }
];

// Rules whose findings are about security although they are not in the security plugin
const SECURITY_RULES = new Set(['no-restricted-syntax']);

// One config for JS and TS. Parsing is syntax-only (no type information),
// so there is no tsconfig lookup and nothing is read from disk.
const config = tseslint.config (
    js.configs.recommended,
    ...tseslint.configs.recommended,
    security.configs.recommended,
    {
        // Flat config only lints files it has a matching entry for, and .jsx/.tsx
        // are not matched by default.
        files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
        languageOptions: {
            parserOptions: { ecmaFeatures: { jsx: true } }
        }
    },
    {
        files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
        rules: {
            // == and != convert types before comparing ('1' == 1); comparing with null is fine
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            // Every obj[key] with a variable key: almost always a false alarm (it flagged a
            // plain array loop), so it hid the findings that matter
            'security/detect-object-injection': 'off',
            // HTML written from a string, where text from a user can run as script (XSS). Built
            // in, so no extra plugin is needed.
            'no-restricted-syntax': ['error', ...XSS_SINKS]
        }
    },
    {
        // A request does not say where the code runs, so plain JavaScript gets the Node and
        // the browser globals. Without them every `require`, `process` or `document` would
        // be reported as an undefined variable. A real typo is still caught.
        files: ['**/*.{js,jsx,mjs,cjs}'],
        languageOptions: {
            globals: { ...globals.node, ...globals.browser }
        },
        // `require()` is how plain Node JavaScript imports things. The rule stays on for TypeScript.
        rules: { '@typescript-eslint/no-require-imports': 'off' }
    }
);

// Created once and reused: building an ESLint instance is the slow part.
let eslint: ESLint | undefined;
const getESLint = (): ESLint =>
    (eslint ??= new ESLint({
        overrideConfigFile: true,
        overrideConfig: config as unknown as Linter.Config[],
        cwd: process.cwd()
    }));

// Rules that point at a likely bug rather than a style or upkeep issue.
const BUG_RULES = new Set([
    'eqeqeq', 'no-undef','no-unreachable', 'no-dupe-args','no-dupe-keys','no-redeclare',
    'no-self-assign', 'no-const-assign', 'no-cond-assign', 'no-fallthrough',
    'no-empty', 'no-func-assign', 'no-import-assign', 'use-isnan', 'valid-typeof',
    'no-unsafe-finally', 'no-unsafe-negation', 'getter-return', 'no-constant-condition'
]);

function toCategory(message: Linter.LintMessage): string {
    if (message.fatal) return 'bug'; // syntax error
    const rule = message.ruleId ?? '';
    if (rule.startsWith('security/') || SECURITY_RULES.has(rule)) return 'security';
    if (BUG_RULES.has(rule)) return 'bug';
    return 'maintainability';
}

function toSeverity(message: Linter.LintMessage, category: string): Severity {
    if (message.fatal || category === 'security') return 'high';
    return message.severity === 2 ? 'medium' : 'low';
}

function toFinding(message: Linter.LintMessage, request: ReviewRequest): Finding {
    const category = toCategory(message);
    const rule = message.ruleId ? ` (${message.ruleId})` : '';
    return {
        file: request.filename,
        line: message.line,
        message: `${message.message}${rule}`,
        severity: toSeverity(message, category),
        category,
        source: 'eslint'
    };
}

function isFirstOccurrence(finding: Finding, index: number, all: Finding[]): boolean {
    return all.findIndex((other) => other.line === finding.line && other.message === finding.message) === index;
}

export const eslintAdapter: Analyzer = {
    name: 'eslint',

    supports(language: string): boolean {
        return (
            language === SUPPORTED_LANGUAGES.JAVASCRIPT ||
            language === SUPPORTED_LANGUAGES.TYPESCRIPT
        );
    },

    async analyze(request: ReviewRequest, signal?: AbortSignal): 
    Promise<Finding[]> {
        // A virtual path inside cwd: lintText never reads it, but ESLint uses the
        // extension to pick the parser and the cwd to decide the file isn't ignored.
        // safeFilename has no separators, so this can't escape the folder.
        // is not start work that nobody is waiting for any more.
        signal?.throwIfAborted();

        const filePath = path.join(process.cwd(), request.safeFilename);

        const results = await getESLint().lintText(request.code, { filePath });

        return results
            .flatMap((result) => result.messages)
            .filter((message) => {
                // A non-fatal message with no rule is ESLint talking about itself
                // (for example "file ignored"). It is not a finding about the code.
                if (!message.ruleId && !message.fatal) {
                    logger.warn('ESLint notice skipped', { notice: message.message });
                    return false;
                }
                return message.line > 0;
            })
            .map((message) => toFinding(message, request))
            .filter(isFirstOccurrence)
    }
};