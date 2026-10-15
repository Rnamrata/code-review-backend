import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { appConfig } from '../../config/app.config';
import { Finding } from '../../models/finding';
import { ReviewRequest } from '../../models/review.model';
import { ruffAdapter } from './ruff.adapter';

// These tests run the real Ruff binary. They are skipped when it is not installed,
// so the suite still passes on a machine without Ruff. CI installs it.
const ruffAvailable = spawnSync(appConfig.ruffBin, ['--version']).status === 0;

const request = (code: string, filename = 'app.py', overrides: Partial<ReviewRequest> = {}): ReviewRequest => ({
  filename,
  safeFilename: filename.replace(/[^a-zA-Z0-9._-]/g, '_'),
  language: 'python',
  code,
  ...overrides
});

const review = (code: string, filename?: string, overrides?: Partial<ReviewRequest>): Promise<Finding[]> =>
  ruffAdapter.analyze(request(code, filename, overrides));

describe('ruffAdapter basics', () => {
  it('supports python only', () => {
    expect(ruffAdapter.supports('python')).toBe(true);
    for (const other of ['javascript', 'typescript', 'java', 'py', '']) {
      expect(ruffAdapter.supports(other)).toBe(false);
    }
  });

  it('identifies itself as ruff', () => {
    expect(ruffAdapter.name).toBe('ruff');
  });
});

describe.skipIf(!ruffAvailable)('ruffAdapter with the real Ruff binary', () => {
  describe('clean code', () => {
    it('returns no findings', async () => {
      expect(await review('x = 1\nprint(x)\n')).toEqual([]);
    });

    it('returns no findings for empty code', async () => {
      expect(await review('')).toEqual([]);
    });
  });

  describe('security findings', () => {
    it('reports eval as a high severity security finding', async () => {
      const findings = await review('def run(a):\n    return eval(a)\n');

      const found = findings.find((f) => f.message.includes('(S307)'));
      expect(found).toBeDefined();
      expect(found).toMatchObject({ severity: 'high', category: 'security', line: 2 });
    });

    it('is not fooled by a noqa comment', async () => {
      const findings = await review('import os  # noqa\neval("1")  # noqa: S307\n');

      expect(findings.some((f) => f.message.includes('(F401)'))).toBe(true);
      expect(findings.some((f) => f.message.includes('(S307)'))).toBe(true);
    });

    it('does not report assert statements', async () => {
      const findings = await review('def f(a):\n    assert a\n');

      expect(findings.some((f) => f.message.includes('(S101)'))).toBe(false);
    });
  });

  describe('bug findings', () => {
    it('reports an undefined name as a medium severity bug', async () => {
      const findings = await review('print(undefined_name)\n');

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: 'medium',
        category: 'bug',
        line: 1,
        message: 'Undefined name `undefined_name` (F821)'
      });
    });

    it('reports a mutable default argument and offers a fix', async () => {
      const findings = await review('def f(a, b=[]):\n    return a\n');

      const found = findings.find((f) => f.message.includes('(B006)'));
      expect(found).toMatchObject({ severity: 'medium', category: 'bug', line: 1 });
      expect(found?.suggestion).toBeTruthy();
    });
  });

  describe('maintainability findings', () => {
    it('reports an unused import with a suggested fix', async () => {
      const findings = await review('import os\n');

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: 'low',
        category: 'maintainability',
        line: 1,
        suggestion: 'Remove unused import: `os`'
      });
    });

    it('has no suggestion when Ruff offers no fix', async () => {
      const findings = await review('print(undefined_name)\n');

      expect(findings[0].suggestion).toBeUndefined();
    });
  });

  describe('syntax errors', () => {
    it('reports exactly one high severity bug', async () => {
      const findings = await review('def f(:\n');

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: 'high', category: 'bug', line: 1 });
    });

    it('does not add a rule code to the message', async () => {
      const findings = await review('def f(:\n');

      expect(findings[0].message).not.toMatch(/\([A-Z0-9-]+\)$/);
    });
  });

  describe('result shape', () => {
    it('tags every finding with source "ruff"', async () => {
      const findings = await review('import os\nprint(undefined_name)\n');

      expect(findings.length).toBeGreaterThan(1);
      expect(findings.every((f) => f.source === 'ruff')).toBe(true);
    });

    it('reports findings under the original filename', async () => {
      const findings = await review('import os\n', 'my app.py');

      expect(findings.every((f) => f.file === 'my app.py')).toBe(true);
    });

    it('copes with a file name that starts with a hyphen', async () => {
      const findings = await review('import os\n', '-rf.py');

      expect(findings).toHaveLength(1);
      expect(findings[0].file).toBe('-rf.py');
    });

    it('handles Windows line endings', async () => {
      const findings = await review('import os\r\nx = 1\r\n');

      expect(findings).toHaveLength(1);
      expect(findings[0].line).toBe(1);
    });
  });
});