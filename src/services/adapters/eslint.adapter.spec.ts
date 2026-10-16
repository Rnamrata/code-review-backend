import { describe, expect, it } from 'vitest';
import { Finding } from '../../models/finding';
import { ReviewRequest } from '../../models/review.model';
import { eslintAdapter } from './eslint.adapter';

// Builds a request; the file name decides which parser ESLint uses.
const request = (code: string, filename = 'app.js', overrides: Partial<ReviewRequest> = {}): ReviewRequest => ({
  filename,
  safeFilename: filename.replace(/[^a-zA-Z0-9._-]/g, '_'),
  language: filename.endsWith('.js') || filename.endsWith('.jsx') ? 'javascript' : 'typescript',
  code,
  ...overrides
});

const review = (code: string, filename?: string, overrides?: Partial<ReviewRequest>): Promise<Finding[]> =>
  eslintAdapter.analyze(request(code, filename, overrides));

describe('eslintAdapter', () => {
  describe('supports', () => {
    it.each(['javascript', 'typescript'])('supports %s', (language) => {
      expect(eslintAdapter.supports(language)).toBe(true);
    });

    it.each(['python', 'java', 'cpp', 'csharp', 'js', ''])('does not support "%s"', (language) => {
      expect(eslintAdapter.supports(language)).toBe(false);
    });

    it('identifies itself as eslint', () => {
      expect(eslintAdapter.name).toBe('eslint');
    });
  });

  describe('clean code', () => {
    it('returns no findings', async () => {
      expect(await review('export const answer = 42;\n')).toEqual([]);
    });

    it('returns no findings for empty code', async () => {
      expect(await review('')).toEqual([]);
    });
  });

  describe('security findings', () => {
    it('reports eval as a high severity security finding', async () => {
      const findings = await review('export function run(input) {\n  return eval(input);\n}\n');

      const evalFinding = findings.find((f) => f.message.includes('security/detect-eval-with-expression'));
      expect(evalFinding).toBeDefined();
      expect(evalFinding).toMatchObject({ severity: 'high', category: 'security', line: 2 });
    });
  });

  describe('bug findings', () => {
    it('reports an undefined name as a medium severity bug', async () => {
      const findings = await review('export const x = missingFunction();\n');

      const undef = findings.find((f) => f.message.includes('(no-undef)'));
      expect(undef).toBeDefined();
      expect(undef).toMatchObject({ severity: 'medium', category: 'bug', line: 1 });
    });
  });

  describe('maintainability findings', () => {
    it('reports an unused variable', async () => {
      const findings = await review('const unused = 1;\nexport const used = 2;\n');

      const unused = findings.find((f) => f.message.includes('never used'));
      expect(unused).toBeDefined();
      expect(unused).toMatchObject({ category: 'maintainability', line: 1 });
    });
  });

  describe('syntax errors', () => {
    it('reports one high severity bug for code that does not parse', async () => {
      const findings = await review('const = ;\n');

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: 'high', category: 'bug', line: 1 });
      expect(findings[0].message).toMatch(/parsing error/i);
    });
  });

  describe('TypeScript and JSX', () => {
    it('parses TypeScript syntax without a parse error', async () => {
      const findings = await review(
        'interface User { name: string }\nexport const u: User = { name: "a" };\n',
        'user.ts'
      );

      expect(findings.some((f) => /parsing error/i.test(f.message))).toBe(false);
    });

    it('reports a rule violation in a TypeScript file', async () => {
      const findings = await review('var x: number = 1;\nexport { x };\n', 'x.ts');

      expect(findings.some((f) => f.message.includes('(no-var)'))).toBe(true);
    });

    it('parses JSX in a .jsx file', async () => {
      const findings = await review('export const el = <div className="a" />;\n', 'view.jsx');

      expect(findings.some((f) => /parsing error/i.test(f.message))).toBe(false);
    });

    it('parses TSX in a .tsx file', async () => {
      const findings = await review('export const el = <div className="a" />;\n', 'view.tsx');

      expect(findings.some((f) => /parsing error/i.test(f.message))).toBe(false);
    });
  });

  describe('result shape', () => {
    it('tags every finding with source "eslint"', async () => {
      const findings = await review('var a = eval(input);\nundefinedFn();\n');

      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((f) => f.source === 'eslint')).toBe(true);
    });

    it('only returns findings with a positive line number', async () => {
      const findings = await review('var a = eval(input);\nundefinedFn();\n');

      expect(findings.every((f) => f.line > 0)).toBe(true);
    });

    it('puts the rule name in every message', async () => {
      const findings = await review('var a = eval(input);\nundefinedFn();\n');

      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((f) => /\([^)]+\)$/.test(f.message))).toBe(true);
    });

    it('reports findings under the original filename, not the sanitized one', async () => {
      const findings = await review('var a = 1;\nexport { a };\n', 'my file.ts');

      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((f) => f.file === 'my file.ts')).toBe(true);
    });

    it('picks the parser from the sanitized name, so a space in the name is harmless', async () => {
      const findings = await review('const x: number = 1;\nexport { x };\n', 'my file.ts');

      expect(findings.some((f) => /parsing error/i.test(f.message))).toBe(false);
    });
  });
});