import path from "path";
import { ESLint, Linter} from 'eslint';
import js from "@eslint/js";
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import { SUPPORTED_LANGUAGES } from '../../constants/fileTypes';
import { Finding, Severity } from '../../models/finding';
import { Analyzer, ReviewRequest } from '../../models/review.model';
import { logger } from '../../utils/logger.util';


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
    'no-undef','no-unreachable', 'no-dupe-args','no-dupe-keys','no-redeclare',
    'no-self-assign', 'no-const-assign', 'no-cond-assign', 'no-fallthrough',
    'no-empty', 'no-func-assign', 'no-import-assign', 'use-isnan', 'valid-typeof',
    'no-unsafe-finally', 'no-unsafe-negation', 'getter-return', 'no-constant-condition'
]);

function toCategory(message: Linter.LintMessage): string {
    if (message.fatal) return 'bug'; // syntax error
    const rule = message.ruleId ?? '';
    if (rule.startsWith('security/')) return 'security';
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

export const eslintAdapter: Analyzer = {
    name: 'eslint',

    supports(language: string): boolean {
        return (
            language === SUPPORTED_LANGUAGES.JAVASCRIPT ||
            language === SUPPORTED_LANGUAGES.TYPESCRIPT
        );
    },

    async analyze(request: ReviewRequest): Promise<Finding[]> {
        // A virtual path inside cwd: lintText never reads it, but ESLint uses the
        // extension to pick the parser and the cwd to decide the file isn't ignored.
        // safeFilename has no separators, so this can't escape the folder.
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
            .map((message) => toFinding(message, request));
    }
};