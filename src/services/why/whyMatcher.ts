import { Finding, Why } from '../../models/finding';
import { CARDS_BY_ID, Lang, WhyCard } from './whyCards';

// Which card a finding gets. Linter findings name their rule at the end of the message
// ("... (S608)", "... (eqeqeq)"), so their card is exact. AI findings are matched by the words
// of their message; when nothing clearly fits, a finding gets no card rather than a wrong one.

const RUFF_RULES: Record<string, string> = {
    S608: 'sql-injection',
    S102: 'code-eval',
    S307: 'code-eval',
    S113: 'missing-timeout',
    S105: 'hardcoded-secret',
    S106: 'hardcoded-secret',
    S107: 'hardcoded-secret',
    S303: 'weak-hash',
    S304: 'weak-hash',
    S305: 'weak-hash',
    S324: 'weak-hash',
    S311: 'insecure-random',
    S301: 'unsafe-deserialization',
    S302: 'unsafe-deserialization',
    S403: 'unsafe-deserialization',
    S506: 'unsafe-deserialization',
    S314: 'xxe',
    S318: 'xxe',
    S320: 'xxe',
    S501: 'tls-off',
    S323: 'tls-off',
    S602: 'command-injection',
    S603: 'command-injection',
    S604: 'command-injection',
    S605: 'command-injection',
    S606: 'command-injection',
    S607: 'command-injection',
    S110: 'swallowed-exception',
    S112: 'swallowed-exception',
    E722: 'bare-except',
    E711: 'none-comparison',
    E712: 'none-comparison',
    B006: 'mutable-default',
    B008: 'mutable-default',
    F401: 'unused-code',
    F811: 'unused-code',
    F841: 'unused-code'
};

const ESLINT_RULES: Record<string, string> = {
    eqeqeq: 'loose-equality',
    'no-restricted-syntax': 'xss-html', // only used for the HTML sinks (see eslint.adapter.ts)
    'no-var': 'var-declaration',
    '@typescript-eslint/no-explicit-any': 'any-type',
    'no-unused-vars': 'unused-code',
    '@typescript-eslint/no-unused-vars': 'unused-code',
    'no-eval': 'code-eval',
    'no-implied-eval': 'code-eval',
    'no-new-func': 'code-eval',
    'security/detect-eval-with-expression': 'code-eval',
    'security/detect-child-process': 'command-injection',
    'security/detect-non-literal-fs-filename': 'path-traversal',
    'security/detect-unsafe-regex': 'regex-dos',
    'security/detect-non-literal-regexp': 'regex-dos',
    'security/detect-pseudoRandomBytes': 'insecure-random',
    'no-empty': 'swallowed-exception'
};

// For AI findings: the first topic whose words appear in the message. Specific ones come first
// ("command injection" before "injection", "unboxing" before "null").
const TOPICS: [RegExp, string][] = [
    [/command injection|Runtime\.getRuntime|ProcessBuilder|shell=True|os\.system|subprocess/i, 'command-injection'],
    [/\bsql\b|prepared ?statement|query (?:is )?built/i, 'sql-injection'],
    [/\bxxe\b|external entit/i, 'xxe'],
    [/deserializ|ObjectInputStream|\bpickle\b|yaml\.load/i, 'unsafe-deserialization'],
    [/\beval\b|\bexec\(|new Function/i, 'code-eval'],
    [/\bxss\b|cross-site scripting|innerHTML|outerHTML|insertAdjacentHTML|document\.write/i, 'xss-html'],
    [/path traversal|\.\.\//i, 'path-traversal'],
    [/certificate|hostname verif|TrustManager|verify=False/i, 'tls-off'],
    [/\bmd5\b|\bsha-?1\b|weak (?:hash|cipher)|\bECB\b/i, 'weak-hash'],
    [/java\.util\.Random|Math\.random|SecureRandom|\brandom\b[^.]{0,40}\b(?:token|password|key|secret)/i, 'insecure-random'],
    [/\b(?:password|secret|token)s?\b[^.]{0,40}\b(?:logged|in (?:a|the) log|to the console)|\blog(?:s|ged|ging)?\b[^.]{0,40}\b(?:password|secret|token)/i, 'secret-in-log'],
    [/hard-?coded (?:password|secret|key|api key|token|credential)|\b(?:password|api[ _-]?key|secret|token|credential)s?\b[^.]{0,30}\b(?:exposed|hard-?coded|written into)/i, 'hardcoded-secret'],
    [/localStorage|sessionStorage/i, 'token-in-storage'],
    [/\btimeout\b/i, 'missing-timeout'],
    [/not awaited|unawaited|without await|floating promise/i, 'unawaited-promise'],
    [/response\.ok|status (?:code )?(?:is )?(?:not|never) checked|http error/i, 'unchecked-response'],
    [/JSON\.parse/i, 'json-parse'],
    [/\bsplice\b/i, 'splice-in-loop'],
    [/\bsort\b[^.]{0,40}(?:in place|mutat|original)|(?:in place|mutat)[^.]{0,40}\bsort\b/i, 'sort-in-place'],
    [/hashCode/i, 'equals-hashcode'],
    [/Optional\.get|\bOptional\b/i, 'optional-get'],
    [/SimpleDateFormat|thread-?safe|several threads|shared mutable/i, 'shared-mutable-static'],
    [/StringBuilder|concatenat[^.]{0,40}loop|\+=[^.]{0,30}loop/i, 'string-concat-loop'],
    [/unbox|(?:int|long|boolean)\b[^.]{0,40}\bnull\b/i, 'null-unboxing'],
    [/before (?:it is |the |its )?(?:null )?check|before the (?:line|one) that checks|null check comes too late|used before[^.]{0,30}null/i, 'null-before-check'],
    [/divi(?:de|sion) by (?:zero|a count|the length|len)|ZeroDivisionError|division by zero|can be zero/i, 'divide-by-zero'],
    [/off-?by-?one|one (?:step |item |element )?(?:past|beyond|too many)|<= ?(?:the )?(?:length|len|size)|IndexOutOfBounds|out[- ]of[- ](?:bounds|range)|index out of range|IndexError/i, 'off-by-one'],
    [/float(?:ing)?[- ]point|money[^.]{0,30}==/i, 'float-equality'],
    [/not closed|never closed|unclosed|resource leak|try-with-resources|\bleak/i, 'unclosed-resource'],
    [/swallow|empty catch|printStackTrace|caught and ignored|ignor(?:es|ed|ing) (?:the )?(?:error|exception)|too broad|catch(?:es|ing)? all exceptions|without (?:handling|re-?raising)|bare except/i, 'swallowed-exception'],
    [/equals\(\)|compared with == or !=|strings? compared with ==/i, 'string-equality'],
    [/===|loose equality|type coercion/i, 'loose-equality'],
    [/== ?None|is None/i, 'none-comparison'],
    [/mutable default|default argument/i, 'mutable-default'],
    [/\bany\b type|explicit any|type any/i, 'any-type'],
    [/\bnull\b|\bNone\b|\bundefined\b|can return nothing|may be missing|can be missing/i, 'missing-value'],
    [/\bunused\b|never used/i, 'unused-code']
];

const LANGS: Record<string, Lang> = { python: 'python', java: 'java', javascript: 'javascript', typescript: 'typescript' };

/** The rule a linter finding names at the end of its message: "(S608)" → S608. */
const ruleOf = (message: string): string | undefined => /\(([@\w/-]+)\)\s*$/.exec(message)?.[1];

function cardIdFor(finding: Finding, lang: Lang | undefined): string | undefined {
    switch (finding.source) {
        case 'secrets':
            return 'hardcoded-secret';
        case 'ruff':
            return RUFF_RULES[ruleOf(finding.message) ?? ''];
        case 'eslint':
            return ESLINT_RULES[ruleOf(finding.message) ?? ''];
        default: {
            const text = finding.message;
            for (const [pattern, id] of TOPICS) {
                if (!pattern.test(text)) continue;
                const card = CARDS_BY_ID.get(id);
                // A card for another language means this topic doesn't fit: keep looking
                if (card?.langs && lang && !card.langs.includes(lang)) continue;
                return id;
            }
            return undefined;
        }
    }
}

/** What a finding carries: the card worded for the file's language. */
export function toWhy(card: WhyCard, lang?: Lang): Why {
    const source = (lang && card.sourceBy?.[lang]) || card.source;
    return {
        id: card.id,
        title: card.title,
        reason: card.why,
        fix: (lang && card.fixBy?.[lang]) || card.fix,
        source: source.name,
        url: source.url
    };
}

export function whyFor(finding: Finding, language: string): Why | undefined {
    const lang = LANGS[language];
    const id = cardIdFor(finding, lang);
    const card = id ? CARDS_BY_ID.get(id) : undefined;
    if (!card || (card.langs && lang && !card.langs.includes(lang))) return undefined;
    return toWhy(card, lang);
}

/** Adds each finding's card; findings that already have one keep it. */
export function withWhy(findings: Finding[], language: string): Finding[] {
    return findings.map((f) => {
        if (f.why) return f;
        const why = whyFor(f, language);
        return why ? { ...f, why } : f;
    });
}
