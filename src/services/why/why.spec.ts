import { describe, expect, it } from 'vitest';
import { Finding } from '../../models/finding';
import { CARDS_BY_ID, WHY_CARDS } from './whyCards';
import { whyFor, withWhy } from './whyMatcher';

const finding = (overrides: Partial<Finding>): Finding => ({
  file: 'app.py',
  line: 1,
  message: 'a problem',
  severity: 'medium',
  source: 'llm',
  ...overrides
});

const cardFor = (language: string, overrides: Partial<Finding>) => whyFor(finding(overrides), language)?.id ?? null;

describe('why cards', () => {
  it('have unique ids', () => {
    expect(new Set(WHY_CARDS.map((c) => c.id)).size).toBe(WHY_CARDS.length);
  });

  it.each(WHY_CARDS.map((c) => [c.id, c] as const))('%s is complete, short and links to an https page', (_id, card) => {
    for (const text of [card.title, card.why, card.fix, ...Object.values(card.fixBy ?? {})]) {
      expect(text.trim().length).toBeGreaterThan(5);
      expect(text).not.toMatch(/\n/);
    }
    expect(card.why.length).toBeLessThan(200);
    for (const source of [card.source, ...Object.values(card.sourceBy ?? {})]) {
      expect(source!.name.length).toBeGreaterThan(3);
      expect(source!.url).toMatch(/^https:\/\/[\w.-]+\//);
    }
  });
});

describe('whyFor: linter rules', () => {
  it.each([
    ['python', 'ruff', 'Possible SQL injection vector through string-based query construction (S608)', 'sql-injection'],
    ['python', 'ruff', 'Use of possibly insecure function; consider using `ast.literal_eval` (S307)', 'code-eval'],
    ['python', 'ruff', 'Probable use of `requests` call without timeout (S113)', 'missing-timeout'],
    ['python', 'ruff', 'Do not use mutable data structures for argument defaults (B006)', 'mutable-default'],
    ['python', 'ruff', 'Do not use bare `except` (E722)', 'bare-except'],
    ['python', 'ruff', 'Comparison to `None` should be `cond is None` (E711)', 'none-comparison'],
    ['python', 'ruff', '`os` imported but unused (F401)', 'unused-code'],
    ['typescript', 'eslint', "Expected '===' and instead saw '=='. (eqeqeq)", 'loose-equality'],
    ['typescript', 'eslint', 'HTML is set from a string with innerHTML or outerHTML (XSS). (no-restricted-syntax)', 'xss-html'],
    ['typescript', 'eslint', 'Unexpected any. Specify a different type. (@typescript-eslint/no-explicit-any)', 'any-type'],
    ['javascript', 'eslint', 'Unexpected var, use let or const instead. (no-var)', 'var-declaration'],
    ['java', 'pmd', "Ensure that resources like this 'Connection' object are closed after use (CloseResource)", 'unclosed-resource'],
    ['java', 'pmd', "Use equals() to compare strings instead of '==' or '!=' (UseEqualsToCompareStrings)", 'string-equality'],
    ['java', 'pmd', 'Avoid empty catch blocks (EmptyCatchBlock)', 'swallowed-exception'],
    ['java', 'pmd', 'Avoid printStackTrace(); use a logger call instead. (AvoidPrintStackTrace)', 'swallowed-exception'],
    ['java', 'pmd', 'Static DateFormatter objects should be accessed in a synchronized manner (UnsynchronizedStaticFormatter)', 'shared-mutable-static'],
    ['java', 'pmd', 'Ensure you override both equals() and hashCode() (OverrideBothEqualsAndHashcode)', 'equals-hashcode'],
    ['java', 'pmd', 'Do not use hard coded encryption keys (HardCodedCryptoKey)', 'hardcoded-secret'],
    ["java", 'pmd', "Avoid unused private fields such as 'cache'. (UnusedPrivateField)", 'unused-code']
  ] as const)('%s %s: %s', (language, source, message, id) => {
    expect(cardFor(language, { source, message })).toBe(id);
  });

  it('gives every secret-scan finding the secrets card', () => {
    expect(cardFor('java', { source: 'secrets', message: 'Hard-coded secret: DB_PASSWORD is set to a string in the code' })).toBe('hardcoded-secret');
  });

  it('gives a linter rule with no card none', () => {
    expect(cardFor('python', { source: 'ruff', message: 'Line too long (E501)' })).toBeNull();
    expect(cardFor('python', { source: 'ruff', message: 'No rule code here' })).toBeNull();
    expect(cardFor('java', { source: 'pmd', message: 'Do not use a hard coded IV (InsecureCryptoIv)' })).toBeNull();
  });
});

describe('whyFor: AI reviewer findings, by topic', () => {
  it.each([
    ['java', 'SQL query built by joining strings with a value from outside (use a PreparedStatement with parameters)', 'sql-injection'],
    ['java', 'Strings compared with == or != instead of equals()', 'string-equality'],
    ['java', 'Map lookup stored in an int, long or boolean: for a missing key get returns null and unboxing it throws', 'null-unboxing'],
    ['java', 'java.util.Random used to make a token, password or key (use SecureRandom)', 'insecure-random'],
    ['java', 'Value used (a method called on it) on a line before the one that checks it for null', 'null-before-check'],
    ['java', 'Exception swallowed (an empty catch block, or only printStackTrace) instead of handled', 'swallowed-exception'],
    ['python', 'Division by zero if products list is empty.', 'divide-by-zero'],
    ['python', 'Index out of range. Should be `end = start + page_size`.', 'off-by-one'],
    ['python', 'Database connection is not closed after commit.', 'unclosed-resource'],
    ['python', 'Floating-point comparison. Consider using `math.isclose`.', 'float-equality'],
    ['python', 'Logging exceptions without re-raising can hide errors', 'swallowed-exception'],
    ['typescript', 'Loop runs one step past the last element, causing an out-of-bounds access', 'off-by-one'],
    ['typescript', 'Fetch call is not awaited, causing the next lines to run before it finishes', 'unawaited-promise'],
    ['typescript', 'API_KEY is exposed in the code.', 'hardcoded-secret']
  ] as const)('%s: %s', (language, message, id) => {
    expect(cardFor(language, { message })).toBe(id);
  });

  it('gives no card when nothing clearly fits, rather than a wrong one', () => {
    expect(cardFor('python', { message: 'The function does not handle the case where `poll` fails.' })).toBeNull();
    expect(cardFor('typescript', { message: "Hardcoded discount code 'SAVE10' in total method." })).toBeNull();
  });

  it("never gives a card meant for another language", () => {
    // equals() is Java advice; in TypeScript the same words find no Java card
    expect(cardFor('typescript', { message: 'Strings compared with == instead of equals()' })).not.toBe('string-equality');
    expect(cardFor('python', { message: 'Fetch call is not awaited' })).toBeNull();
  });
});

describe('the card a finding carries', () => {
  it('uses the wording and the source for the file’s language', () => {
    const java = whyFor(finding({ message: 'SQL query built by joining strings (use a PreparedStatement)' }), 'java')!;
    const python = whyFor(finding({ source: 'ruff', message: 'Possible SQL injection (S608)' }), 'python')!;

    expect(java).toMatchObject({ id: 'sql-injection', title: 'SQL built from input', source: 'Java tutorial: Using Prepared Statements' });
    expect(java.fix).toContain('PreparedStatement');
    expect(python.source).toBe('OWASP SQL Injection Prevention');
    expect(python.url).toBe('https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html');
    expect(python.fix).toContain('cursor.execute');
    expect(python.reason).toBe(CARDS_BY_ID.get('sql-injection')!.why);
  });

  it('is added to each finding that has one, and leaves the others as they were', () => {
    const plain = finding({ message: 'Something else entirely' });
    const [withCard, without] = withWhy([finding({ source: 'ruff', message: 'Bare except (E722)' }), plain], 'python');

    expect(withCard.why?.id).toBe('bare-except');
    expect(without).toBe(plain);
  });
});
