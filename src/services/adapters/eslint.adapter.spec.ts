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

    describe('cancelling', () => {
    it('does not start when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(eslintAdapter.analyze(request('var a = 1;\n'), controller.signal)).rejects.toThrow();
    });

    it('reviews normally when the signal has not been aborted', async () => {
      const controller = new AbortController();

      const findings = await eslintAdapter.analyze(request('var a = eval(input);\n'), controller.signal);

      expect(findings.length).toBeGreaterThan(0);
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

  describe('plain Node and browser JavaScript', () => {
    const messagesOf = async (code: string, filename = 'app.js') => (await review(code, filename)).map((f) => f.message);

    it('does not flag require as an undefined variable', async () => {
      const messages = await messagesOf("const fs = require('fs');\nexport const read = fs.readFileSync;\n");

      expect(messages.some((m) => m.includes("'require' is not defined"))).toBe(false);
    });

    it('does not flag require() style imports in JavaScript', async () => {
      const messages = await messagesOf("const fs = require('fs');\nexport const read = fs.readFileSync;\n");

      expect(messages.some((m) => m.includes('no-require-imports'))).toBe(false);
    });

    it('does not flag require() style imports in a .jsx file', async () => {
      const messages = await messagesOf("const fs = require('fs');\nexport const el = <p>{String(fs)}</p>;\n", 'view.jsx');

      expect(messages.some((m) => m.includes('no-require-imports'))).toBe(false);
    });

    // The name is used as a plain value: ESLint's no-undef ignores names inside typeof.
    it.each(['module', 'exports', 'process', 'console', '__dirname', '__filename', 'Buffer', 'setTimeout'])(
      'knows the Node global %s',
      async (name) => {
        const messages = await messagesOf(`export const value = ${name};\n`);

        expect(messages.some((m) => m.includes(`'${name}' is not defined`))).toBe(false);
      }
    );

    it.each(['document', 'window', 'navigator', 'localStorage', 'fetch', 'alert'])(
      'knows the browser global %s',
      async (name) => {
        const messages = await messagesOf(`export const value = ${name};\n`);

        expect(messages.some((m) => m.includes(`'${name}' is not defined`))).toBe(false);
      }
    );

    it('still reports a misspelled variable', async () => {
      const findings = await review('export const total = prices.length;\n');

      expect(findings.some((f) => f.message.includes("'prices' is not defined"))).toBe(true);
    });

    it('still reports require() style imports in TypeScript', async () => {
      const messages = await messagesOf("const fs = require('fs');\nexport const read = fs.readFileSync;\n", 'app.ts');

      expect(messages.some((m) => m.includes('no-require-imports'))).toBe(true);
    });

    it('keeps the real findings of a Node file', async () => {
      const findings = await review(
        "const { exec } = require('child_process');\nexec('ping ' + process.argv[2]);\neval(process.argv[3]);\n"
      );

      const rules = findings.map((f) => f.message);
      expect(rules.some((m) => m.includes('security/detect-child-process'))).toBe(true);
      expect(rules.some((m) => m.includes('security/detect-eval-with-expression'))).toBe(true);
    });
  });

  describe('noisy security rules', () => {
    it('rates object injection as low, not high', async () => {
      const findings = await review('export const first = (items, i) => items[i];\n');

      const hit = findings.find((f) => f.message.includes('security/detect-object-injection'));
      expect(hit).toBeDefined();
      expect(hit).toMatchObject({ severity: 'low', category: 'security' });
    });

    it('still rates other security rules as high', async () => {
      const findings = await review('export const run = (input) => eval(input);\n');

      const hit = findings.find((f) => f.message.includes('security/detect-eval-with-expression'));
      expect(hit?.severity).toBe('high');
    });
  });

  describe('repeated findings', () => {
    it('reports one finding when the same rule fires twice on a line with the same message', async () => {
      const findings = await review('export const cost = (items, i) => items[i].price * items[i].qty;\n', 'cart.ts');

      const hits = findings.filter((f) => f.message.includes('security/detect-object-injection'));
      expect(hits).toHaveLength(1);
    });

    it('keeps findings that differ in message on the same line', async () => {
      const findings = await review('var unused = 1;\n', 'x.ts');

      const onLineOne = findings.filter((f) => f.line === 1);
      expect(onLineOne.length).toBeGreaterThan(1);
    });

    it('keeps the same message on different lines', async () => {
      const findings = await review('export const a = (items, i) => items[i];\nexport const b = (items, i) => items[i];\n');

      const hits = findings.filter((f) => f.message.includes('security/detect-object-injection'));
      expect(hits.map((f) => f.line)).toEqual([1, 2]);
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