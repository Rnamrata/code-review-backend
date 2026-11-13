// Rule cards for Java: short reminders of problems a small model tends to overlook, each with a
// cheap check on the submitted code. Only the cards whose check matches go into the prompt, so
// the model is told what to look for in this file and is not nudged towards problems that cannot
// be there. (A long list of reminders for every file made the model invent findings.)
//
// The checks only choose between texts written here. Nothing from the submitted code is copied
// into the prompt, so the code cannot add instructions through them.

export interface RuleCard {
    // Short name, used in the debug log so it is clear which cards a review got.
    id: string;
    // Does the card apply to this code? Plain patterns, kept simple and bounded so that a large
    // file cannot make one of them slow.
    applies: (code: string) => boolean;
    // One line, phrased as a thing to look for.
    hint: string;
}

const matches = (pattern: RegExp) => (code: string) => pattern.test(code);

// Comparing with null, a number, a character or true/false is normal Java and says nothing about
// comparing strings with ==, so those comparisons are ignored.
const OPERAND = String.raw`(?:null|true|false|-?\d[\w.]{0,20}|'(?:\\.|[^'\\\n]){1,2}')`;
const NON_STRING_COMPARISON = new RegExp(String.raw`(?:==|!=)[ \t]*${OPERAND}(?![\w.])|(?<![\w.])${OPERAND}[ \t]*(?:==|!=)`, 'g');
const withoutNonStringComparisons = (code: string): string => code.replace(NON_STRING_COMPARISON, '');

// In priority order: when more cards match than fit, the first ones win. Security comes first.
export const JAVA_RULES: readonly RuleCard[] = [
    {
        id: 'sql-injection',
        applies: matches(
            /["']\s*(?:select|insert|update|delete)\b[^"'\n]{0,300}["']\s*\+|\b(?:executeQuery|executeUpdate|prepareStatement|createQuery|createNativeQuery)\s*\([^)\n]{0,300}\+/i
        ),
        hint: 'an SQL query built by joining strings with a value from outside (use a PreparedStatement with parameters) - report it on the line that builds or runs the query'
    },
    {
        id: 'hardcoded-secret',
        applies: matches(/\b\w{0,40}(?:password|passwd|pwd|secret|api[_-]?key|token)\w{0,40}[ \t]*=[ \t]*"[^"\n]+"/i),
        hint: 'a password, key or token written into the source as a string - report it on the line that holds it'
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
        id: 'swallowed-exception',
        applies: matches(/\bcatch\s*\([^)\n]{1,80}\)\s*\{(?![^}]{0,400}\bthrow\b)/),
        hint: 'an exception that is swallowed (an empty catch block, or only printStackTrace) instead of handled or rethrown - report it on the line of the catch clause'
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

// More cards than this made the model pad its answer with weak findings.
export const MAX_RULES = 6;

// When no card matches, the review still gets the three most common reminders. Without them the
// model, left with no hint at all, invented findings on a correct file (12 in four runs, against 0
// with the reminders).
export const GENERAL_IDS = ['string-equality', 'null-result', 'swallowed-exception'];

export function selectRules(code: string, cards: readonly RuleCard[] = JAVA_RULES, max: number = MAX_RULES): RuleCard[] {
    const picked = cards.filter((card) => card.applies(code)).slice(0, max);
    return picked.length > 0 ? picked : cards.filter((card) => GENERAL_IDS.includes(card.id));
}

export function buildJavaHint(selected: readonly RuleCard[]): string | undefined {
    if (selected.length === 0) return undefined;
    return ['Also check for these Java problems:', ...selected.map((card) => `- ${card.hint}`)].join('\n');
}
