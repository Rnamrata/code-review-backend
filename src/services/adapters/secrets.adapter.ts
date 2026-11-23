import { SUPPORTED_LANGUAGES } from '../../constants/fileTypes';
import { Finding, Severity } from '../../models/finding';
import { Analyzer, ReviewRequest } from '../../models/review.model';

// Finds keys, tokens and passwords written into the code. The linters only look at variable
// names (and Ruff's list misses API_KEY), and the model is not reliable at it, so this check
// looks at the values themselves: providers give their keys a recognisable shape.
//
// A finding never repeats the secret, only what kind it is: findings are stored by the chatbot
// and shown in the browser, and a leaked key must not be copied further.

interface KnownFormat {
    name: string;
    pattern: RegExp;
    severity: Severity;
    note?: string;
    // Not a provider's own key format, so a match in a comment or example is likely an illustration
    heuristic?: boolean;
    // A further check on the match, the line and the line after it
    confirm?: (match: RegExpExecArray, line: string, next: string) => boolean;
}

// Key data: base64 that follows a PEM header, on the same line ("...KEY-----\nMIIE...") or the next
const KEY_DATA = /^[A-Za-z0-9+/=]{40,}/;
const hasKeyData = (match: RegExpExecArray, line: string, next: string): boolean => {
    const after = line.slice(match.index + match[0].length).replace(/^\\n|^\s+/, '');
    return KEY_DATA.test(after) || KEY_DATA.test(next.trim().replace(/^["'`]/, ''));
};

// A real password in a URL has a digit or a symbol, or is long; "org:repo@", "foo:bar@",
// "TOKEN@<id>" and "a%20secret" are how documentation shows the shape.
const realUrlPassword = (match: RegExpExecArray): boolean => {
    const password = match[1];
    if (/[[\]<>%{}]/.test(password) || /^[A-Z_]+$/.test(password)) return false;
    return /[\d!#$&*+,;=?^~-]/.test(password) || password.length >= 12;
};

// Each pattern is anchored on a fixed prefix and bounded, so a long line cannot make it slow.
const KNOWN_FORMATS: readonly KnownFormat[] = [
    { name: 'Stripe live secret key', pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{10,100}/, severity: 'high' },
    {
        name: 'Stripe live publishable key',
        pattern: /\bpk_live_[0-9A-Za-z]{10,100}/,
        severity: 'medium',
        note: 'Publishable keys are meant for the browser, but a live key belongs in configuration, not in the code.'
    },
    { name: 'AWS access key ID', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, severity: 'high' },
    { name: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,120})/, severity: 'high' },
    { name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,100}/, severity: 'high' },
    { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}/, severity: 'high' },
    { name: 'OpenAI or Anthropic API key', pattern: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,200}/, severity: 'high' },
    { name: 'private key', pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/, severity: 'high', confirm: hasKeyData },
    { name: 'JSON Web Token', pattern: /\beyJ[A-Za-z0-9_-]{10,500}\.eyJ[A-Za-z0-9_-]{10,1000}\.[A-Za-z0-9_-]{10,500}/, severity: 'high' },
    {
        name: 'password in a connection URL',
        // "user:pass@" and "user:password@" are how documentation writes the shape
        pattern: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@'"`]{1,100}:(?!(?:pass|password|passwd|pwd|secret|x+|\*+)@)([^\s@'"`/]{3,100})@/i,
        severity: 'high',
        heuristic: true,
        confirm: realUrlPassword
    }
];

// A name that says what it holds, assigned a string literal on the same line:
// DB_PASSWORD = "...", apiKey: '...', "client_secret": "...", private String token = "...".
// The kind of secret ends the name (DB_PASSWORD, apiKey, oauth_token_secret). Where it starts
// the name, the name describes something else: TOKEN_COMMENT, tokenize, PASSWORD_FIELD.
const SECRET_NAME = String.raw`[\w$]{0,40}?(?:password|passwd|pwd|secret|token|api_?key|apikey|access_?key|private_?key|auth_?key)\d{0,3}(?![\w$])`;
const NAMED_SECRET = new RegExp(
    String.raw`["']?(${SECRET_NAME})["']?\s*(?::=|=|:)\s*(?:f|r|b)?(["'\x60])([^"'\x60\n]{1,200})\2`,
    'i'
);

// Values that are not real secrets: empty-ish, placeholders, references to configuration,
// or ordinary text (a sentence such as "Password is required" has spaces).
const PLACEHOLDER = /^(?:x+|\*+|\.+|-+|<[^>]*>|\$\{[^}]*\}|%\(?\w*\)?s?|\{\{[^}]*\}\}|changeme|change_me|your[_-].*|example.*|dummy|placeholder|redacted|none|null|undefined|todo|tbd)$/i;
const MIN_VALUE_CHARS = 6;

// The words a secret's name is made of; a value spelled from them names a setting
const KIND_WORDS = /password|passwd|pwd|secret|token|key|auth|access|private|api|client|refresh|session/gi;
const letters = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

// A value that is the name of something rather than a secret: an environment variable
// ("AWS_SECRET_ACCESS_KEY"), a field name ("refreshToken", "use_auth_token"), a path or
// ID ("auth-request-type/it"), an elided example ("hf_...", "sk-...").
function looksLikeAName(name: string, value: string): boolean {
    if (letters(value) === letters(name)) return true;
    if (/\.\.\.|[/\\:]/.test(value)) return true;
    if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(value)) return true;
    // Only letters and separators, and made of the same words as a secret's name
    if (/^[A-Za-z_-]+$/.test(value) && letters(value.replace(KIND_WORDS, '')).length <= 4) return true;
    return /^[a-z]+(?:[_-][a-z]+)+$/.test(value) || /^[a-z]+(?:[A-Z][a-z]+)+$/.test(value);
}

function namedSecret(line: string): string | undefined {
    const match = NAMED_SECRET.exec(line);
    if (!match) return undefined;
    const [, name, , value] = match;
    if (value.length < MIN_VALUE_CHARS || /\s/.test(value) || PLACEHOLDER.test(value)) return undefined;
    // A name like TOKEN_URL or PASSWORD_FIELD holds a URL or a label, not the secret
    if (/(?:url|uri|endpoint|field|label|header|name|path|file|prompt|message|hint|regex|pattern|type|id)$/i.test(name)) {
        return undefined;
    }
    if (/^https?:\/\//i.test(value) || /[{}]/.test(value) || looksLikeAName(name, value)) return undefined;
    return name;
}

// Comments and examples in documentation ("# password='...'", ">>> login(token='...')"):
// only a provider's own key format counts there, since that is a real key whatever surrounds it.
const COMMENT_OR_EXAMPLE = /^\s*(?:#|\/\/|\/\*|\*|>>>|\.\.\.|--|<!--)/;

function knownFormat(line: string, next: string, isComment: boolean): KnownFormat | undefined {
    return KNOWN_FORMATS.find((format) => {
        if (isComment && format.heuristic) return false;
        const match = format.pattern.exec(line);
        return match !== null && (!format.confirm || format.confirm(match, line, next));
    });
}

function scanLine(line: string, next: string, lineNumber: number, request: ReviewRequest): Finding | undefined {
    const isComment = COMMENT_OR_EXAMPLE.test(line);
    const known = knownFormat(line, next, isComment);
    if (known) {
        return {
            file: request.filename,
            line: lineNumber,
            message: `Hard-coded ${known.name} in the code`,
            severity: known.severity,
            category: 'security',
            source: 'secrets',
            suggestion: known.note
                ? `${known.note} Read it from an environment variable or a secret manager.`
                : 'Read it from an environment variable or a secret manager, and rotate it: anyone who can read this code has it.'
        };
    }

    // An escape inside a string ("import os\nPASSWORD = ...") is not part of a name
    const name = isComment ? undefined : namedSecret(line.replace(/\\[nrt]/g, ' '));
    if (name) {
        return {
            file: request.filename,
            line: lineNumber,
            message: `Hard-coded secret: ${name} is set to a string in the code`,
            severity: 'high',
            category: 'security',
            source: 'secrets',
            suggestion: 'Read it from an environment variable or a secret manager, and change it: anyone who can read this code has it.'
        };
    }
    return undefined;
}

const SCANNED_LANGUAGES: ReadonlySet<string> = new Set([
    SUPPORTED_LANGUAGES.PYTHON,
    SUPPORTED_LANGUAGES.JAVASCRIPT,
    SUPPORTED_LANGUAGES.TYPESCRIPT,
    SUPPORTED_LANGUAGES.JAVA
]);

// Longer lines are minified code or data, where a match means little and scanning costs a lot.
const MAX_LINE_CHARS = 2000;

export const secretsAdapter: Analyzer = {
    name: 'secrets',
    supplementary: true,

    // The languages the linters and the AI reviewer cover; and as it is supplementary, it only
    // runs when one of them does too.
    supports(language: string): boolean {
        return SCANNED_LANGUAGES.has(language);
    },

    async analyze(request: ReviewRequest, signal?: AbortSignal): Promise<Finding[]> {
        signal?.throwIfAborted();
        const findings: Finding[] = [];
        const lines = request.code.split(/\r?\n/);
        lines.forEach((line, index) => {
            if (line.length > MAX_LINE_CHARS) return;
            const finding = scanLine(line, (lines[index + 1] ?? '').slice(0, MAX_LINE_CHARS), index + 1, request);
            if (finding) findings.push(finding);
        });
        return findings;
    }
};
