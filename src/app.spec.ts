import { spawnSync } from 'child_process';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from './app';
import { appConfig } from './config/app.config';

// End-to-end through the real orchestrator and the real analyzers.
// The Ruff part is skipped when Ruff is not installed; CI installs it.
const ruffAvailable = spawnSync(appConfig.ruffBin, ['--version']).status === 0;

describe('app end to end', () => {
  it('answers /health without starting a listener', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  describe('JavaScript', () => {
    it('reviews code and reports a security finding', async () => {
      const res = await request(app)
        .post('/review')
        .send({ filename: 'app.js', language: 'js', code: 'export function run(i) {\n  return eval(i);\n}\n' });

      expect(res.status).toBe(200);
      expect(res.body.warnings).toEqual([]);
      const evalFinding = res.body.findings.find((f: any) => f.category === 'security');
      expect(evalFinding).toMatchObject({ file: 'app.js', line: 2, severity: 'high', source: 'eslint' });
    });

    it('sorts the most severe finding first', async () => {
      const res = await request(app)
        .post('/review')
        .send({
          filename: 'app.js',
          language: 'javascript',
          code: 'const unused = 1;\nexport function run(i) {\n  return eval(i);\n}\n'
        });

      expect(res.body.findings[0].severity).toBe('high');
    });

    it('returns a summary that matches the findings', async () => {
      const res = await request(app)
        .post('/review')
        .send({ filename: 'app.js', language: 'js', code: 'var a = eval(input);\nundefinedFn();\n' });

      const { findings, summary } = res.body;
      expect(summary.total).toBe(findings.length);
      expect(summary.bySource).toEqual({ eslint: findings.length });
    });

    it('returns no findings and no warnings for clean code', async () => {
      const res = await request(app)
        .post('/review')
        .send({ filename: 'ok.js', language: 'js', code: 'export const answer = 42;\n' });

      expect(res.status).toBe(200);
      expect(res.body.findings).toEqual([]);
      expect(res.body.warnings).toEqual([]);
      expect(res.body.summary.total).toBe(0);
    });
  });

  describe('TypeScript', () => {
    it('reviews a TypeScript file', async () => {
      const res = await request(app)
        .post('/review')
        .send({ filename: 'user.ts', language: 'ts', code: 'var x: number = 1;\nexport { x };\n' });

      expect(res.status).toBe(200);
      expect(res.body.findings.length).toBeGreaterThan(0);
      expect(res.body.findings.every((f: any) => f.source === 'eslint')).toBe(true);
    });
  });

  describe.skipIf(!ruffAvailable)('Python (needs Ruff)', () => {
    it('reviews code and keeps findings top-level', async () => {
      const res = await request(app)
        .post('/review')
        .send({ filename: 'a.py', language: 'py', code: 'import os\n' });

      expect(res.status).toBe(200);
      expect(res.body.findings[0]).toMatchObject({ file: 'a.py', source: 'ruff', line: 1 });
    });

    it('reports eval as a high severity security finding first', async () => {
      const res = await request(app)
        .post('/review')
        .send({ filename: 'a.py', language: 'python', code: 'import os\ndef f(a):\n    return eval(a)\n' });

      expect(res.body.findings[0]).toMatchObject({ severity: 'high', category: 'security', line: 3 });
    });
  });

  describe('file names', () => {
    it('reports findings under the name the caller sent', async () => {
      const res = await request(app)
        .post('/review')
        .send({ filename: 'my component.ts', language: 'ts', code: 'var x = 1;\nexport { x };\n' });

      expect(res.body.findings.length).toBeGreaterThan(0);
      expect(res.body.findings.every((f: any) => f.file === 'my component.ts')).toBe(true);
    });

    it('copes with non-ASCII characters in the name', async () => {
      const res = await request(app)
        .post('/review')
        .send({ filename: 'résumé.js', language: 'js', code: 'var a = 1;\nundefinedFn();\n' });

      expect(res.status).toBe(200);
      expect(res.body.findings.every((f: any) => f.file === 'résumé.js')).toBe(true);
    });
  });

  describe('a language with no analyzer', () => {
    it('returns no findings but says why', async () => {
      const res = await request(app)
        .post('/review')
        .send({ filename: 'Main.java', language: 'java', code: 'class Main {}\n' });

      expect(res.status).toBe(200);
      expect(res.body.findings).toEqual([]);
      expect(res.body.warnings).toHaveLength(1);
      expect(res.body.warnings[0].source).toBe('orchestrator');
      expect(res.body.warnings[0].message).toContain('java');
    });
  });

  describe('invalid input', () => {
    it('rejects an unsupported extension with 400', async () => {
      const res = await request(app)
        .post('/review')
        .send({ filename: 'a.txt', language: 'python', code: 'x' });

      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown routes', async () => {
      expect((await request(app).get('/nope')).status).toBe(404);
    });
  });

  describe('concurrency', () => {
    it('handles several reviews at once without mixing them up', async () => {
      const names = Array.from({ length: 8 }, (_, i) => `file-${i}.js`);

      const responses = await Promise.all(
        names.map((filename) =>
          request(app).post('/review').send({ filename, language: 'js', code: 'var a = eval(input);\n' })
        )
      );

      responses.forEach((res, i) => {
        expect(res.status).toBe(200);
        expect(res.body.findings.every((f: any) => f.file === names[i])).toBe(true);
      });
    });
  });
});