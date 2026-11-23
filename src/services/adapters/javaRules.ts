// Rule cards for Java (see ruleCards.ts for how cards work).
import { LanguageRules, MAX_RULES, RuleCard, buildHint, matches, pickCards } from './ruleCards';

export { MAX_RULES };
export type { RuleCard };

// Comparing with null, a number, a character or true/false is normal Java and says nothing about
// comparing strings with ==, so those comparisons are ignored.
const OPERAND = String.raw`(?:null|true|false|-?\d[\w.]{0,20}|'(?:\\.|[^'\\\n]){1,2}')`;
const NON_STRING_COMPARISON = new RegExp(String.raw`(?:==|!=)[ \t]*${OPERAND}(?![\w.])|(?<![\w.])${OPERAND}[ \t]*(?:==|!=)`, 'g');
const withoutNonStringComparisons = (code: string): string => code.replace(NON_STRING_COMPARISON, '');

// In priority order: when more cards match than fit, the first ones win. Security comes first,
// then logic bugs. Hard-coded secrets are not here: the secret scan finds those on every review.
export const JAVA_RULES: readonly RuleCard[] = [
    {
        id: 'sql-injection',
        applies: matches(
            /["']\s*(?:select|insert|update|delete)\b[^"'\n]{0,300}["']\s*\+|\b(?:executeQuery|executeUpdate|prepareStatement|createQuery|createNativeQuery)\s*\([^)\n]{0,300}\+/i
        ),
        hint: 'an SQL query built by joining strings with a value from outside (use a PreparedStatement with parameters) - report it on the line that builds or runs the query'
    },
    {
        id: 'command-injection',
        applies: matches(/\bRuntime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*exec\b|\bnew\s+ProcessBuilder\b/),
        hint: 'a command that is run with text that can come from a caller (command injection) - report it on the line that runs the command'
    },
    {
        id: 'path-traversal',
        applies: matches(
            /\bnew\s+(?:File|FileReader|FileWriter|FileInputStream|FileOutputStream|RandomAccessFile)\s*\(|\bPaths\s*\.\s*get\s*\(/
        ),
        hint: 'a file path built from a method argument without checking that it stays inside the intended folder (path traversal)'
    },
    {
        id: 'unsafe-deserialization',
        applies: matches(/\bObjectInputStream\b|\.\s*readObject\s*\(/),
        hint: 'an object read with ObjectInputStream from data that can come from outside - report it on the line that creates the stream'
    },
    {
        id: 'xxe',
        applies: matches(/\b(?:DocumentBuilderFactory|SAXParserFactory|XMLInputFactory|TransformerFactory)\s*\.\s*newInstance\b/),
        hint: 'an XML parser created without turning off external entities and DTDs (XXE) - report it on the line that creates the factory'
    },
    {
        id: 'weak-crypto',
        applies: matches(/\bgetInstance\s*\(\s*"(?:MD5|SHA-?1|DES|DESede|RC4|AES|AES\/ECB[^"]{0,20})"/i),
        hint: 'a weak or broken hash or cipher (MD5, SHA-1, DES, ECB mode), for example to hash a password - report it on the line that asks for it'
    },
    {
        id: 'insecure-random',
        applies: (code) => /\bnew\s+Random\s*\(/.test(code) && /token|password|secret|session|nonce|\botp\b/i.test(code),
        hint: 'java.util.Random used to make a token, password or key (use SecureRandom)'
    },
    {
        id: 'tls-checks-off',
        applies: matches(/\bX509TrustManager\b|\bHostnameVerifier\b|\bsetHostnameVerifier\b|ALLOW_ALL_HOSTNAME_VERIFIER/),
        hint: 'certificate or host name checks that are switched off'
    },
    {
        id: 'secret-in-log',
        applies: matches(/\b(?:log|logger|LOG|LOGGER|System\s*\.\s*out)\b[^;\n]{0,200}\b(?:password|passwd|secret|token|apiKey)\b/i),
        hint: 'a password, token or other secret written to a log or to the console'
    },
    // Logic bugs (#15): the model missed every one of these until it was asked
    {
        id: 'unboxing-null',
        applies: matches(/\b(?:int|long|double|float|boolean|char|short|byte)\s+\w+\s*=\s*[\w.]{1,60}\.\s*get\s*\(/),
        hint: 'a map lookup stored in an int, long or boolean: for a missing key get returns null and unboxing it throws NullPointerException - report it on the line of the lookup'
    },
    {
        id: 'use-before-null-check',
        applies: matches(/(?:==|!=)\s*null\b|\bnull\s*(?:==|!=)/),
        hint: 'a value used (a method called on it) on a line before the one that checks it for null, so the check comes too late - report it on the line that uses it'
    },
    {
        id: 'swallowed-exception',
        applies: matches(/\bcatch\s*\([^)\n]{1,80}\)\s*\{(?![^}]{0,400}\bthrow\b)/),
        hint: 'an exception that is swallowed (an empty catch block, or only printStackTrace) instead of handled or rethrown - report it on the line of the catch clause'
    },
    {
        id: 'off-by-one',
        applies: matches(/<=\s*[\w.]{1,60}\.\s*(?:length\b|size\s*\(\s*\))/),
        hint: 'a loop that runs while i <= length or size(), one step past the last element'
    },
    {
        id: 'string-equality',
        applies: (code) => {
            const rest = withoutNonStringComparisons(code);
            return /\bString\b/.test(rest) && /[^=!<>]==[^=]|!=/.test(rest);
        },
        hint: 'strings compared with == or != instead of equals()'
    },
    {
        id: 'null-result',
        applies: matches(/\breturn\s+null\b|=\s*[\w.]{1,60}\.\s*get\s*\([^()\n]{0,60}\)\s*;|\.\s*get\s*\([^()\n]{0,60}\)\s*\.\s*\w/),
        hint: 'a method that can return null (a map lookup, a find method) whose result is used without a null check'
    },
    {
        id: 'optional-get',
        applies: (code) => /\bOptional\b/.test(code) && /\.\s*get\s*\(\s*\)/.test(code),
        hint: 'Optional.get() called without checking that a value is present'
    },
    {
        id: 'unclosed-resource',
        applies: (code) =>
            !/\btry\s*\(/.test(code) &&
            /\bnew\s+(?:FileInputStream|FileOutputStream|FileReader|FileWriter|BufferedReader|BufferedWriter|PrintWriter|Scanner|Socket)\s*\(|\bgetConnection\s*\(|\.\s*createStatement\s*\(/.test(code),
        hint: 'a stream, reader, writer, connection or statement that is opened and never closed (use try-with-resources) - report it on the line that opens it'
    },
    {
        id: 'equals-without-hashcode',
        applies: (code) => /\bboolean\s+equals\s*\(\s*(?:final\s+)?Object\b/.test(code) && !/\bint\s+hashCode\s*\(/.test(code),
        hint: 'equals() overridden without hashCode()'
    },
    {
        id: 'shared-mutable-static',
        applies: matches(/\bstatic\b[^;(\n]{0,80}\b(?:SimpleDateFormat|DateFormat|HashMap|ArrayList|HashSet|LinkedList|Calendar)\b/),
        hint: 'a static SimpleDateFormat or other mutable object that several threads can use at the same time'
    },
    {
        id: 'string-concat-in-loop',
        applies: (code) => /\b(?:for|while)\s*\(/.test(code) && /\+=[ \t]*(?:"|\w+[ \t]*\+[ \t]*")/.test(code),
        hint: 'a String built with += inside a loop (use StringBuilder)'
    }
];

// When no card matches, the review still gets the three most common reminders.
export const GENERAL_IDS = ['string-equality', 'null-result', 'swallowed-exception'];

export const JAVA: LanguageRules = { name: 'Java', cards: JAVA_RULES, generalIds: GENERAL_IDS };

export function selectRules(code: string, cards: readonly RuleCard[] = JAVA_RULES, max: number = MAX_RULES): RuleCard[] {
    return pickCards(code, { ...JAVA, cards }, max);
}

export function buildJavaHint(selected: readonly RuleCard[]): string | undefined {
    return buildHint('Java', selected);
}
