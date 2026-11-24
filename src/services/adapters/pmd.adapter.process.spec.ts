import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync, readFileSync } from 'fs';
import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfig } from '../../config/app.config';
import { ReviewRequest } from '../../models/review.model';
import { pmdAdapter } from './pmd.adapter';

// Replace the real process launcher, so these tests cover every kind of PMD outcome without Java.
vi.mock('child_process', () => ({ spawn: vi.fn() }));

const spawnMock = vi.mocked(spawn);

interface Script {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  signal?: NodeJS.Signals | null;
  error?: NodeJS.ErrnoException;
}

let args: string[] = [];
let fileSeen = '';
let codeSeen = '';

function stub(script: Script): void {
  spawnMock.mockImplementation(((_bin: string, a: string[]) => {
    args = a;
    fileSeen = a[a.indexOf('--dir') + 1];
    codeSeen = readFileSync(fileSeen, 'utf8');
    const child: any = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    setImmediate(() => {
      if (script.error) {
        child.emit('error', script.error);
        return;
      }
      if (script.stdout) child.stdout.write(script.stdout);
      if (script.stderr) child.stderr.write(script.stderr);
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', script.code ?? 0, script.signal ?? null));
    });
    return child;
  }) as any);
}

const request = (overrides: Partial<ReviewRequest> = {}): ReviewRequest => ({
  filename: 'UserDao.java',
  safeFilename: 'UserDao.java',
  language: 'java',
  code: 'class UserDao {}\n',
  ...overrides
});

const violation = (rule: string, line: number, description: string) => ({
  beginline: line,
  begincolumn: 5,
  endline: line,
  endcolumn: 20,
  description,
  rule,
  ruleset: 'Error Prone',
  priority: 3
});

const report = (extra: object) => JSON.stringify({ formatVersion: 0, pmdVersion: '7.0.0', files: [], processingErrors: [], configurationErrors: [], ...extra });

beforeEach(() => {
  appConfig.pmdEnabled = true;
  spawnMock.mockReset();
});

afterEach(() => {
  appConfig.pmdEnabled = false;
});

describe('the PMD adapter', () => {
  it('runs for Java only, and only when PMD_ENABLED is on', () => {
    expect(pmdAdapter.supports('java')).toBe(true);
    expect(pmdAdapter.supports('python')).toBe(false);
    appConfig.pmdEnabled = false;
    expect(pmdAdapter.supports('java')).toBe(false);
  });

  it('turns violations into findings with the rule at the end, and a category and severity from the rule', async () => {
    stub({
      code: 4,
      stdout: report({
        files: [{
          filename: '/tmp/x/UserDao.java',
          violations: [
            violation('CloseResource', 12, "Ensure that resources like this 'Connection' object are closed after use"),
            violation('UseEqualsToCompareStrings', 20, 'Use equals() to compare strings instead of \'==\' or \'!=\''),
            violation('HardCodedCryptoKey', 7, 'Do not use hard coded encryption keys'),
            violation('UnusedPrivateField', 3, "Avoid unused private fields such as 'cache'.")
          ]
        }]
      })
    });

    const findings = await pmdAdapter.analyze(request());

    expect(findings.map((f) => [f.line, f.category, f.severity, f.message])).toEqual([
      [12, 'reliability', 'medium', "Ensure that resources like this 'Connection' object are closed after use (CloseResource)"],
      [20, 'bug', 'medium', "Use equals() to compare strings instead of '==' or '!=' (UseEqualsToCompareStrings)"],
      [7, 'security', 'high', 'Do not use hard coded encryption keys (HardCodedCryptoKey)'],
      [3, 'maintainability', 'low', "Avoid unused private fields such as 'cache'. (UnusedPrivateField)"]
    ]);
    expect(findings.every((f) => f.source === 'pmd' && f.file === 'UserDao.java')).toBe(true);
  });

  it('reads the code from a private temp file named for Java, and removes it afterwards', async () => {
    stub({ code: 0, stdout: report({}) });

    await pmdAdapter.analyze(request({ safeFilename: 'notes.txt', code: 'class A { int x; }' }));

    expect(fileSeen.endsWith('notes.txt.java')).toBe(true);
    expect(codeSeen).toBe('class A { int x; }');
    expect(existsSync(fileSeen)).toBe(false);
  });

  it('does not let the code hide findings with NOPMD or @SuppressWarnings', async () => {
    stub({
      code: 4,
      stdout: report({
        suppressedViolations: [{ violation: violation('EmptyCatchBlock', 9, 'Avoid empty catch blocks'), suppressiontype: 'annotation' }]
      })
    });

    const findings = await pmdAdapter.analyze(request());

    const marker = args[args.indexOf('--suppress-marker') + 1];
    expect(marker).not.toBe('NOPMD');
    expect(marker).toMatch(/^X[0-9a-f]{16}$/);
    expect(args).toContain('--show-suppressed');
    expect(findings.map((f) => f.message)).toEqual(['Avoid empty catch blocks (EmptyCatchBlock)']);
  });

  it('reports a file it cannot parse as one syntax error on its line', async () => {
    stub({
      code: 5,
      stdout: report({
        processingErrors: [{
          filename: '/tmp/x/UserDao.java',
          message: "ParseException: Parse exception in file '/tmp/x/UserDao.java' at line 4, column 9: Encountered \"}\" at line 4, column 9.",
          detail: 'net.sourceforge.pmd.lang.ast.ParseException: ...'
        }]
      })
    });

    const findings = await pmdAdapter.analyze(request());

    expect(findings).toEqual([{
      file: 'UserDao.java',
      line: 4,
      message: 'Java syntax error: Encountered "}" at line 4, column 9; the file could not be checked further',
      severity: 'high',
      category: 'bug',
      source: 'pmd'
    }]);
  });

  it.each([
    ['PMD is not installed', { error: Object.assign(new Error('spawn pmd ENOENT'), { code: 'ENOENT' }) }, /PMD not found at "pmd"/],
    ['PMD itself fails', { code: 1, stderr: 'Exception in thread "main"' }, /PMD failed \(exit 1\): Exception in thread/],
    ['PMD is stopped', { code: null, signal: 'SIGTERM' as NodeJS.Signals }, /PMD was stopped \(SIGTERM\)/],
    ['PMD prints something that is not JSON', { code: 0, stdout: 'not json', stderr: 'oops' }, /PMD returned invalid JSON: oops/],
    ['a rule is missing from this PMD version', { code: 0, stdout: report({ configurationErrors: [{ rule: 'CloseResource', message: 'not found' }] }) }, /PMD rule set problem: CloseResource not found/]
  ])('fails with a clear reason when %s', async (_name, script, message) => {
    stub(script);

    await expect(pmdAdapter.analyze(request())).rejects.toThrow(message);
    expect(existsSync(fileSeen)).toBe(false);
  });
});
