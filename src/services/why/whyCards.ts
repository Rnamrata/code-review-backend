// "Why" cards: for each kind of problem, why it matters, how to fix it, and where the advice comes
// from. Written in our own words from the OWASP cheat sheets, PEP 8 and the Python docs, the Google
// JavaScript Style Guide and MDN, the TypeScript handbook and Oracle's Java docs, with a link to the
// page. A finding gets the card for its rule (linters, secret scan) or its topic (the AI reviewer).

export type Lang = 'python' | 'java' | 'javascript' | 'typescript';

export interface Source {
    name: string;
    url: string;
}

export interface WhyCard {
    id: string;
    /** A short name for the problem, shown as the card's heading. */
    title: string;
    /** Why it matters, in one or two sentences. */
    why: string;
    /** How to fix it, with the language's own wording where it differs. */
    fix: string;
    fixBy?: Partial<Record<Lang, string>>;
    source: Source;
    sourceBy?: Partial<Record<Lang, Source>>;
    /** Only for these languages (a Java-only rule, for example); all when left out. */
    langs?: Lang[];
}

const OWASP = (page: string, name: string): Source => ({
    name: `OWASP ${name}`,
    url: `https://cheatsheetseries.owasp.org/cheatsheets/${page}.html`
});
const MDN = (path: string, name: string): Source => ({
    name: `MDN: ${name}`,
    url: `https://developer.mozilla.org/en-US/docs/${path}`
});
const PYDOCS = (path: string, name: string): Source => ({ name: `Python docs: ${name}`, url: `https://docs.python.org/3/${path}` });
const PEP8 = (anchor: string, name: string): Source => ({ name: `PEP 8: ${name}`, url: `https://peps.python.org/pep-0008/#${anchor}` });
const JAVA_API = (path: string, name: string): Source => ({
    name: `Java docs: ${name}`,
    url: `https://docs.oracle.com/en/java/javase/21/docs/api/java.base/${path}`
});
const JAVA_TUTORIAL = (path: string, name: string): Source => ({
    name: `Java tutorial: ${name}`,
    url: `https://docs.oracle.com/javase/tutorial/${path}`
});
const SCRIPT_LANGS: Lang[] = ['javascript', 'typescript'];

export const WHY_CARDS: readonly WhyCard[] = [
    // ---------- Security ----------
    {
        id: 'sql-injection',
        title: 'SQL built from input',
        why: 'Text that reaches the query can change what it does: one quote in a name can read, change or delete other rows.',
        fix: 'Pass values as query parameters instead of joining them into the SQL.',
        fixBy: {
            python: 'Pass values as parameters: cursor.execute("... WHERE name = ?", (name,)).',
            java: 'Use a PreparedStatement with ? placeholders and set each value with setString, setInt and so on.',
            javascript: 'Use your database library\'s parameters (placeholders such as $1 or ?), never a template string.',
            typescript: 'Use your database library\'s parameters (placeholders such as $1 or ?), never a template string.'
        },
        source: OWASP('SQL_Injection_Prevention_Cheat_Sheet', 'SQL Injection Prevention'),
        sourceBy: { java: JAVA_TUTORIAL('jdbc/basics/prepared.html', 'Using Prepared Statements') }
    },
    {
        id: 'command-injection',
        title: 'Command run with outside text',
        why: 'If any part of a shell command comes from outside, a caller can add their own commands to it.',
        fix: 'Avoid the shell: call the program directly with its arguments as a list, and check the values against what is allowed.',
        fixBy: { python: 'Call subprocess.run([...]) with a list of arguments and shell=False.' },
        source: OWASP('OS_Command_Injection_Defense_Cheat_Sheet', 'OS Command Injection Defense')
    },
    {
        id: 'code-eval',
        title: 'Code run from a string',
        why: 'eval and exec run whatever text they get, so text from a form or a file becomes code with the program\'s rights.',
        fix: 'Parse the value instead of running it, or allow only a fixed set of operations.',
        fixBy: {
            python: 'Use ast.literal_eval for plain values, or parse the input yourself; never eval or exec input.',
            javascript: 'Use JSON.parse for data, and a lookup of allowed functions instead of eval or new Function.',
            typescript: 'Use JSON.parse for data, and a lookup of allowed functions instead of eval or new Function.'
        },
        source: OWASP('Injection_Prevention_Cheat_Sheet', 'Injection Prevention'),
        sourceBy: { python: PYDOCS('library/ast.html#ast.literal_eval', 'ast.literal_eval') }
    },
    {
        id: 'xss-html',
        title: 'HTML built from text',
        why: 'Text written into the page as HTML is run as HTML: a name such as <img onerror=…> runs script in every viewer\'s browser.',
        fix: 'Set textContent, or build the elements with createElement; if you must use HTML, sanitize it first.',
        source: OWASP('Cross_Site_Scripting_Prevention_Cheat_Sheet', 'Cross Site Scripting Prevention'),
        sourceBy: {
            javascript: MDN('Web/API/Element/innerHTML#security_considerations', 'innerHTML, security considerations'),
            typescript: MDN('Web/API/Element/innerHTML#security_considerations', 'innerHTML, security considerations')
        }
    },
    {
        id: 'hardcoded-secret',
        title: 'Secret in the code',
        why: 'Anyone who can read the code, its history or a copy of it has the key, and it can\'t be changed without a new release.',
        fix: 'Read it from an environment variable or a secret manager, and replace (rotate) the key that was in the code.',
        source: OWASP('Secrets_Management_Cheat_Sheet', 'Secrets Management')
    },
    {
        id: 'weak-hash',
        title: 'Weak hash or cipher',
        why: 'MD5, SHA-1, DES and ECB mode are broken or fast to guess, so what they protect can be recovered.',
        fix: 'For passwords use a slow password hash (Argon2id, scrypt or bcrypt); for other data use SHA-256 or AES-GCM.',
        source: OWASP('Password_Storage_Cheat_Sheet', 'Password Storage')
    },
    {
        id: 'insecure-random',
        title: 'Guessable random value',
        why: 'Ordinary random number generators can be predicted, so tokens, reset links and keys made with them can be guessed.',
        fix: 'Use a cryptographically secure generator for anything secret.',
        fixBy: {
            python: 'Use the secrets module (secrets.token_urlsafe), not random.',
            java: 'Use java.security.SecureRandom, not java.util.Random.',
            javascript: 'Use crypto.getRandomValues or crypto.randomUUID, not Math.random.',
            typescript: 'Use crypto.getRandomValues or crypto.randomUUID, not Math.random.'
        },
        source: OWASP('Cryptographic_Storage_Cheat_Sheet', 'Cryptographic Storage'),
        sourceBy: {
            python: PYDOCS('library/secrets.html', 'secrets'),
            java: JAVA_API('java/security/SecureRandom.html', 'SecureRandom')
        }
    },
    {
        id: 'unsafe-deserialization',
        title: 'Objects read from outside data',
        why: 'Turning outside bytes back into objects (pickle, ObjectInputStream, yaml.load) can run code hidden in them.',
        fix: 'Read plain data formats such as JSON, or use the safe loader (yaml.safe_load) and check what you read.',
        source: OWASP('Deserialization_Cheat_Sheet', 'Deserialization')
    },
    {
        id: 'xxe',
        title: 'XML parser with external entities on',
        why: 'An XML document can ask the parser to read local files or call other servers when external entities are allowed.',
        fix: 'Turn off DTDs and external entities on the parser factory before parsing.',
        source: OWASP('XML_External_Entity_Prevention_Cheat_Sheet', 'XML External Entity Prevention')
    },
    {
        id: 'path-traversal',
        title: 'File path from outside',
        why: 'A name such as ../../etc/passwd can reach files outside the folder the code meant to use.',
        fix: 'Resolve the full path and check that it is still inside the allowed folder, or map names to known files.',
        source: { name: 'OWASP Path Traversal', url: 'https://owasp.org/www-community/attacks/Path_Traversal' }
    },
    {
        id: 'tls-off',
        title: 'Certificate checks switched off',
        why: 'Without certificate and host name checks, anyone on the network can pretend to be the server and read or change the traffic.',
        fix: 'Leave verification on (verify=True, the default trust manager); add the right certificate instead of turning checks off.',
        source: OWASP('Transport_Layer_Security_Cheat_Sheet', 'Transport Layer Security')
    },
    {
        id: 'missing-timeout',
        title: 'Network call without a timeout',
        why: 'A server that never answers holds the call, and whatever waits on it, forever.',
        fix: 'Pass a timeout to every request and handle the error it raises.',
        fixBy: { python: 'Pass timeout=(connect, read), such as requests.post(url, ..., timeout=10).' },
        source: { name: 'Requests docs: Timeouts', url: 'https://requests.readthedocs.io/en/latest/user/advanced/#timeouts' }
    },
    {
        id: 'secret-in-log',
        title: 'Secret written to a log',
        why: 'Logs are kept, copied and read by more people than the data itself, so a password in a log is no longer secret.',
        fix: 'Leave secrets out of log messages, or mask them.',
        source: OWASP('Logging_Cheat_Sheet', 'Logging')
    },
    {
        id: 'regex-dos',
        title: 'Slow regular expression',
        why: 'Some patterns take exponential time on certain inputs, so one long string can stop the program.',
        fix: 'Simplify nested repeats such as (a+)+, limit the input length, or use a fixed pattern.',
        source: { name: 'OWASP Regular expression Denial of Service', url: 'https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS' }
    },
    {
        id: 'token-in-storage',
        title: 'Token kept in localStorage',
        why: 'Any script on the page can read localStorage, so one XSS bug hands over the token.',
        fix: 'Keep session tokens in HttpOnly, Secure cookies instead.',
        source: OWASP('HTML5_Security_Cheat_Sheet', 'HTML5 Security'),
        langs: SCRIPT_LANGS
    },

    // ---------- Reliability: errors and resources ----------
    {
        id: 'swallowed-exception',
        title: 'Error caught and ignored',
        why: 'When an error is caught and dropped (or only printed), the program goes on with bad data and nobody learns why.',
        fix: 'Catch only the errors you can handle, handle them, and let the others go up (or log and re-raise them).',
        source: OWASP('Error_Handling_Cheat_Sheet', 'Error Handling'),
        sourceBy: { python: PEP8('programming-recommendations', 'Programming Recommendations') }
    },
    {
        id: 'bare-except',
        title: 'Bare except',
        why: 'A bare except also catches KeyboardInterrupt and SystemExit, and hides mistakes as well as the error you expected.',
        fix: 'Name the exception you expect (except KeyError:), or at least use except Exception:.',
        source: PEP8('programming-recommendations', 'Programming Recommendations'),
        langs: ['python']
    },
    {
        id: 'unclosed-resource',
        title: 'File or connection never closed',
        why: 'Each open file, socket or connection holds a resource until it is closed; leaked ones run out under load.',
        fix: 'Open it in a block that closes it for you.',
        fixBy: {
            python: 'Use a with block: with open(path) as f: (and with closing(...) for connections).',
            java: 'Use try-with-resources: try (Connection c = ...; Statement s = ...) { ... }.'
        },
        source: PYDOCS('tutorial/inputoutput.html#reading-and-writing-files', 'Reading and writing files'),
        sourceBy: { java: JAVA_TUTORIAL('essential/exceptions/tryResourceClose.html', 'The try-with-resources statement') }
    },
    {
        id: 'unawaited-promise',
        title: 'Promise not awaited',
        why: 'The next lines run before the work finishes, and if it fails the error is lost.',
        fix: 'await the promise (or return it), and handle its error with try/catch.',
        source: MDN('Web/JavaScript/Guide/Using_promises', 'Using promises'),
        langs: SCRIPT_LANGS
    },
    {
        id: 'unchecked-response',
        title: 'HTTP error not checked',
        why: 'A 404 or 500 still returns a response, so code that doesn\'t check the status treats the error page as data.',
        fix: 'Check the status before using the body.',
        fixBy: {
            python: 'Call response.raise_for_status(), or check response.status_code.',
            javascript: 'Check response.ok (or response.status) before reading the body.',
            typescript: 'Check response.ok (or response.status) before reading the body.'
        },
        source: MDN('Web/API/Response/ok', 'Response.ok'),
        sourceBy: { python: { name: 'Requests docs: Response status codes', url: 'https://requests.readthedocs.io/en/latest/user/quickstart/#response-status-codes' } }
    },
    {
        id: 'json-parse',
        title: 'JSON.parse without a guard',
        why: 'JSON.parse throws on bad input, so data from outside can stop the caller.',
        fix: 'Wrap it in try/catch and check the shape of what you parsed.',
        source: MDN('Web/JavaScript/Reference/Global_Objects/JSON/parse', 'JSON.parse'),
        langs: SCRIPT_LANGS
    },

    // ---------- Bugs ----------
    {
        id: 'null-unboxing',
        title: 'null unboxed into a number',
        why: 'Map.get returns null for a missing key, and storing that in an int, long or boolean throws NullPointerException.',
        fix: 'Use getOrDefault(key, 0), or check for null before using the value.',
        source: JAVA_TUTORIAL('java/data/autoboxing.html', 'Autoboxing and Unboxing'),
        langs: ['java']
    },
    {
        id: 'null-before-check',
        title: 'Used before its null check',
        why: 'The value is used on an earlier line than the check, so the check comes too late to prevent the crash.',
        fix: 'Move the null check before the first use of the value.',
        source: JAVA_API('java/lang/NullPointerException.html', 'NullPointerException'),
        sourceBy: { python: PEP8('programming-recommendations', 'Programming Recommendations') }
    },
    {
        id: 'missing-value',
        title: 'A missing value used anyway',
        why: 'A lookup or call that can return null, None or undefined crashes the next line when it does.',
        fix: 'Check for the missing case and decide what to do: a default, an error, or an early return.',
        source: JAVA_API('java/util/Optional.html', 'Optional'),
        sourceBy: {
            python: PYDOCS('library/stdtypes.html#dict.get', 'dict.get'),
            javascript: MDN('Web/JavaScript/Reference/Operators/Optional_chaining', 'Optional chaining'),
            typescript: MDN('Web/JavaScript/Reference/Operators/Optional_chaining', 'Optional chaining')
        }
    },
    {
        id: 'optional-get',
        title: 'Optional.get() without a check',
        why: 'get() throws when the Optional is empty, which is the case Optional exists to handle.',
        fix: 'Use orElse, orElseThrow with a clear error, or ifPresent.',
        source: JAVA_API('java/util/Optional.html', 'Optional'),
        langs: ['java']
    },
    {
        id: 'divide-by-zero',
        title: 'Division by something that can be zero',
        why: 'An empty list or a count of 0 makes the division fail (ZeroDivisionError) or give Infinity or NaN.',
        fix: 'Handle the empty or zero case first, with an early return or a default.',
        source: PYDOCS('library/exceptions.html#ZeroDivisionError', 'ZeroDivisionError'),
        sourceBy: {
            javascript: MDN('Web/JavaScript/Reference/Global_Objects/Infinity', 'Infinity'),
            typescript: MDN('Web/JavaScript/Reference/Global_Objects/Infinity', 'Infinity'),
            java: JAVA_API('java/lang/ArithmeticException.html', 'ArithmeticException')
        }
    },
    {
        id: 'off-by-one',
        title: 'One step past the end',
        why: 'Indexes run from 0 to length - 1, so <= length, or an extra + 1, reads past the end or takes one item too many.',
        fix: 'Loop while i < length, and check slice ends: items[start:start + size] already stops before the end index.',
        source: MDN('Web/JavaScript/Reference/Global_Objects/Array/length', 'Array length'),
        sourceBy: { python: PYDOCS('tutorial/introduction.html#lists', 'Lists and slicing') }
    },
    {
        id: 'splice-in-loop',
        title: 'Items removed while looping forward',
        why: 'splice shifts the following items down, so the loop skips the one after each removal.',
        fix: 'Loop backwards, or build a new array with filter.',
        source: MDN('Web/JavaScript/Reference/Global_Objects/Array/splice', 'Array.prototype.splice()'),
        langs: SCRIPT_LANGS
    },
    {
        id: 'sort-in-place',
        title: 'sort() changes the array',
        why: 'sort reorders the array itself, so a method meant to return a sorted copy also changes the original data.',
        fix: 'Sort a copy: [...items].sort(...), or items.toSorted(...).',
        source: MDN('Web/JavaScript/Reference/Global_Objects/Array/sort', 'Array.prototype.sort()'),
        langs: SCRIPT_LANGS
    },
    {
        id: 'float-equality',
        title: 'Decimal amounts compared with ==',
        why: 'Floating-point sums are rarely exact (0.1 + 0.2 != 0.3), so == on money or measurements gives wrong answers.',
        fix: 'Compare with a tolerance (math.isclose), or keep money in Decimal or whole cents.',
        source: PYDOCS('tutorial/floatingpoint.html', 'Floating-point arithmetic'),
        langs: ['python']
    },
    {
        id: 'string-equality',
        title: 'Strings compared with ==',
        why: 'In Java, == checks whether two strings are the same object, not whether they hold the same text.',
        fix: 'Use a.equals(b), or Objects.equals(a, b) when either can be null.',
        source: JAVA_TUTORIAL('java/data/comparestrings.html', 'Comparing Strings'),
        langs: ['java']
    },
    {
        id: 'loose-equality',
        title: '== instead of ===',
        why: '== converts types before comparing (\'1\' == 1 is true), which hides mistakes.',
        fix: 'Use === and !== (== null alone is fine for null-or-undefined).',
        source: MDN('Web/JavaScript/Equality_comparisons_and_sameness', 'Equality comparisons'),
        langs: SCRIPT_LANGS
    },
    {
        id: 'none-comparison',
        title: 'Comparison to None with ==',
        why: 'A class can redefine ==, so x == None may not mean what it says; is None always does.',
        fix: 'Write x is None, or x is not None.',
        source: PEP8('programming-recommendations', 'Programming Recommendations'),
        langs: ['python']
    },
    {
        id: 'mutable-default',
        title: 'Mutable default argument',
        why: 'A default list or dict is created once and shared by every call, so values from one call show up in the next.',
        fix: 'Default to None and create the list inside: def f(items=None): items = items or [].',
        source: PYDOCS('tutorial/controlflow.html#default-argument-values', 'Default argument values'),
        langs: ['python']
    },
    {
        id: 'equals-hashcode',
        title: 'equals() without hashCode()',
        why: 'Objects that are equal must have the same hash code, or HashMap and HashSet lose track of them.',
        fix: 'Override hashCode with the same fields as equals (Objects.hash(...)), or use a record.',
        source: JAVA_API('java/lang/Object.html#hashCode()', 'Object.hashCode'),
        langs: ['java']
    },
    {
        id: 'shared-mutable-static',
        title: 'Shared state used by several threads',
        why: 'A static map, list or SimpleDateFormat changed by several threads at once loses updates or gives wrong results.',
        fix: 'Use thread-safe types (ConcurrentHashMap, DateTimeFormatter), or keep the state per request.',
        source: JAVA_API('java/text/SimpleDateFormat.html', 'SimpleDateFormat (Synchronization)'),
        langs: ['java']
    },

    // ---------- Maintainability and performance ----------
    {
        id: 'string-concat-loop',
        title: 'String built with += in a loop',
        why: 'Each += copies the whole string, so the loop gets slower the longer the text grows.',
        fix: 'Append to a StringBuilder and call toString() once at the end.',
        source: JAVA_API('java/lang/StringBuilder.html', 'StringBuilder'),
        langs: ['java']
    },
    {
        id: 'unused-code',
        title: 'Unused import or variable',
        why: 'Code that is never used makes readers look for a purpose it doesn\'t have, and can hide a typo.',
        fix: 'Remove it, or use it where it was meant to be used.',
        source: PEP8('imports', 'Imports'),
        sourceBy: {
            javascript: { name: 'ESLint: no-unused-vars', url: 'https://eslint.org/docs/latest/rules/no-unused-vars' },
            typescript: { name: 'ESLint: no-unused-vars', url: 'https://eslint.org/docs/latest/rules/no-unused-vars' }
        }
    },
    {
        id: 'var-declaration',
        title: 'var instead of let or const',
        why: 'var is visible in the whole function and can be declared twice, which makes bugs easy to write.',
        fix: 'Use const by default, and let when the value changes.',
        source: { name: 'Google JavaScript Style Guide: Use const and let', url: 'https://google.github.io/styleguide/jsguide.html#features-use-const-and-let' },
        langs: SCRIPT_LANGS
    },
    {
        id: 'any-type',
        title: 'The any type',
        why: 'any turns off type checking for the value, so mistakes TypeScript would catch go unnoticed.',
        fix: 'Give it a real type or interface, or use unknown and check it before use.',
        source: { name: 'TypeScript handbook: any', url: 'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#any' },
        langs: ['typescript']
    }
];

export const CARDS_BY_ID: ReadonlyMap<string, WhyCard> = new Map(WHY_CARDS.map((card) => [card.id, card]));
