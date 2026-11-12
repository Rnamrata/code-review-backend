import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import Ajv2020 from 'ajv/dist/2020';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import app from './app';
import { SEVERITY_ORDER } from './models/finding';

// A failed analyzer is logged as an error, and two tests below fail one on purpose (an unreachable
// model). This keeps those expected errors out of the test output; everything else is logged as usual.
vi.mock('./utils/logger.util', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./utils/logger.util')>()),
  logError: vi.fn()
}));

// openapi.yaml is written by hand. These tests keep it honest: every example in it must fit its
// schema, and what the running service really answers must fit the schemas and headers it promises.
// If the code changes and the spec is not updated (or the other way round), a test here fails.

const spec: any = parse(readFileSync(path.resolve(__dirname, '../openapi.yaml'), 'utf8'));
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));

// OpenAPI 3.1 uses JSON Schema 2020-12. `format: date-time` is not checked here.
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });

// Checks a value against a schema from the spec. `$ref`s inside it resolve against the spec's components.
const problems = (schema: object, value: unknown): string | null => {
  const validate = ajv.compile({ components: spec.components, ...schema });
  return validate(value) ? null : ajv.errorsText(validate.errors, { separator: '; ' });
};

const jsonSchemaOf = (route: string, method: string, status: number) =>
  spec.paths[route][method].responses[String(status)].content['application/json'].schema;

const declaredHeaders = (route: string, method: string, status: number): string[] =>
  Object.keys(spec.paths[route][method].responses[String(status)].headers ?? {}).map((name) => name.toLowerCase());

// The answer must have the status, the body and the headers the spec promises for it.
const expectToMatchSpec = (route: string, method: string, status: number, res: request.Response) => {
  expect(res.status, `status (body: ${JSON.stringify(res.body).slice(0, 200)})`).toBe(status);
  expect(problems(jsonSchemaOf(route, method, status), res.body), `body ${JSON.stringify(res.body).slice(0, 300)}`).toBeNull();
  for (const header of declaredHeaders(route, method, status)) {
    expect(res.headers[header], `the spec declares the header "${header}", the service did not send it`).toBeDefined();
  }
};

const ruffAvailable = spawnSync('ruff', ['--version']).status === 0;
const ONE_MB = 1024 * 1024;

const js = { filename: 'a.js', language: 'js', code: 'export function run(i) {\n  return eval(i);\n}\n' };
const python = { filename: 'app.py', language: 'py', code: 'import os\nos.system(cmd)\n' };
const java = { filename: 'A.java', language: 'java', code: 'class A {}\n' };

// The app reads its settings when it loads, so a test that needs other settings loads a fresh copy.
const loadApp = async (env: Record<string, string>) => {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return (await import('./app')).default;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('openapi.yaml: the document itself', () => {
  it('is an OpenAPI 3.1 document', () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
  });

  it('has the same version as the package', () => {
    expect(spec.info.version).toBe(pkg.version);
  });

  it('describes the three routes', () => {
    expect(Object.keys(spec.paths).sort()).toEqual(['/health', '/metrics', '/ready', '/review']);
    expect(Object.keys(spec.paths['/review'])).toEqual(['post']);
    expect(Object.keys(spec.paths['/health'])).toEqual(['get']);
    expect(Object.keys(spec.paths['/ready'])).toEqual(['get']);
    expect(Object.keys(spec.paths['/metrics'])).toEqual(['get']);
  });

  it('gives every operation a unique id', () => {
    const ids = Object.values<any>(spec.paths).flatMap((item) => Object.values<any>(item).map((op) => op.operationId));

    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('describes every response', () => {
    for (const item of Object.values<any>(spec.paths)) {
      for (const op of Object.values<any>(item)) {
        for (const response of Object.values<any>(op.responses)) expect(response.description).toBeTruthy();
      }
    }
  });

  it('documents the statuses /review can answer with', () => {
    expect(Object.keys(spec.paths['/review'].post.responses).sort()).toEqual(['200', '400', '413', '429', '500']);
  });

  it('promises a request id on every answer /review can give', () => {
    for (const status of Object.keys(spec.paths['/review'].post.responses)) {
      expect(declaredHeaders('/review', 'post', Number(status)), `status ${status}`).toContain('x-request-id');
    }
  });

  it('only refers to things that exist', () => {
    const refs: string[] = [];
    const walk = (node: any) => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (key === '$ref' && typeof value === 'string') refs.push(value);
          else walk(value);
        }
      }
    };
    walk(spec);

    expect(refs.length).toBeGreaterThan(10);
    for (const ref of refs) {
      const target = ref.replace(/^#\//, '').split('/').reduce((node: any, part) => node?.[part], spec);
      expect(target, `unresolved reference ${ref}`).toBeDefined();
    }
  });

  it('defines no schema that nothing uses', () => {
    const text = JSON.stringify(spec);
    const unused = Object.keys(spec.components.schemas).filter((name) => !text.includes(`#/components/schemas/${name}"`));

    expect(unused).toEqual([]);
  });
});

describe('openapi.yaml: its enums match the code', () => {
  it('lists the same severities as the code, most serious first', () => {
    expect(spec.components.schemas.Severity.enum).toEqual(Object.keys(SEVERITY_ORDER));
  });

  it('lists the analyzers that produce findings', () => {
    expect(spec.components.schemas.FindingSource.enum).toEqual(['eslint', 'ruff', 'llm']);
  });

  it('lets a warning come from the orchestrator as well', () => {
    const options = spec.components.schemas.Warning.properties.source.oneOf;

    expect(options.some((option: any) => option.const === 'orchestrator')).toBe(true);
  });
});

// Every example the spec shows, collected with the schema it claims to fit.
const examples: [string, object, unknown][] = [];
for (const [route, item] of Object.entries<any>(spec.paths)) {
  for (const [method, op] of Object.entries<any>(item)) {
    const medias: [string, any][] = [];
    if (op.requestBody) medias.push([`${method.toUpperCase()} ${route} request`, op.requestBody.content['application/json']]);
    for (const [status, response] of Object.entries<any>(op.responses)) {
      // Only the JSON answers have a schema to check; /metrics answers plain text.
      if (response.content?.['application/json']) medias.push([`${method.toUpperCase()} ${route} ${status}`, response.content['application/json']]);
    }
    for (const [label, media] of medias) {
      if (media.example !== undefined) examples.push([label, media.schema, media.example]);
      for (const [name, example] of Object.entries<any>(media.examples ?? {})) {
        examples.push([`${label} (${name})`, media.schema, example.value]);
      }
    }
  }
}

describe('openapi.yaml: its examples', () => {
  it('are found', () => {
    expect(examples.length).toBeGreaterThanOrEqual(14);
  });

  it.each(examples)('%s fits its schema', (_label, schema, value) => {
    expect(problems(schema, value)).toBeNull();
  });
});

describe('what the service answers matches the spec', () => {
  it('200: a JavaScript review', async () => {
    expectToMatchSpec('/review', 'post', 200, await request(app).post('/review').send(js));
  });

  it('200: the request id is sent back', async () => {
    const res = await request(app).post('/review').set('X-Request-Id', 'contract-1').send(js);

    expect(res.headers['x-request-id']).toBe('contract-1');
  });

  it.runIf(ruffAvailable)('200: a Python review (Ruff)', async () => {
    expectToMatchSpec('/review', 'post', 200, await request(app).post('/review').send(python));
  });

  it('200: no analyzer supports the language, so there is a warning from the orchestrator', async () => {
    const res = await request(app).post('/review').send(java);

    expectToMatchSpec('/review', 'post', 200, res);
    expect(res.body.warnings).toEqual([expect.objectContaining({ source: 'orchestrator' })]);
  });

  it('200: a model that cannot be reached becomes a warning from llm', async () => {
    const llmApp = await loadApp({ LLM_ENABLED: 'true', OLLAMA_BASE_URL: 'http://127.0.0.1:9' });

    const res = await request(llmApp).post('/review').send(java);

    expectToMatchSpec('/review', 'post', 200, res);
    expect(res.body.warnings).toEqual([expect.objectContaining({ source: 'llm' })]);
  });

  it('400: a field is missing', async () => {
    expectToMatchSpec('/review', 'post', 400, await request(app).post('/review').send({ filename: 'a.js' }));
  });

  it('400: the file type is not accepted', async () => {
    expectToMatchSpec('/review', 'post', 400, await request(app).post('/review').send({ ...js, filename: 'a.exe' }));
  });

  it('400: the code is empty', async () => {
    expectToMatchSpec('/review', 'post', 400, await request(app).post('/review').send({ ...js, code: '' }));
  });

  it('400: the body is not valid JSON, and it still carries a request id', async () => {
    const res = await request(app).post('/review').set('Content-Type', 'application/json').send('{bad json');

    expectToMatchSpec('/review', 'post', 400, res);
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('413: the body is too large', async () => {
    const res = await request(app).post('/review').send({ ...js, code: 'x'.repeat(3 * ONE_MB) });

    expectToMatchSpec('/review', 'post', 413, res);
  });

  it('429: too many requests, with the headers the spec lists', async () => {
    const limited = await loadApp({ RATE_LIMIT_MAX_REQUESTS: '1' });
    await request(limited).post('/review').send(js);

    const res = await request(limited).post('/review').send(js);

    expectToMatchSpec('/review', 'post', 429, res);
    expect(declaredHeaders('/review', 'post', 429).sort()).toEqual(['ratelimit', 'ratelimit-policy', 'retry-after', 'x-request-id']);
  });

  it('200: /health', async () => {
    expectToMatchSpec('/health', 'get', 200, await request(app).get('/health'));
  });

  it('200: /metrics is plain text in the Prometheus format', async () => {
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(Object.keys(spec.paths['/metrics'].get.responses['200'].content)).toEqual(['text/plain']);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toMatch(/^# HELP /m);
  });

  it('/metrics: every metric the spec lists is really there, and the labels it names are used', async () => {
    await request(app).post('/review').send(js);
    const text = (await request(app).get('/metrics')).text;
    const description: string = spec.paths['/metrics'].get.description;
    const rows = [...description.matchAll(/^\| `(\w+)` \| (\w+) \| (.*?) \|/gm)];

    expect(rows.length).toBe(8);
    for (const [, name, type, labels] of rows) {
      expect(text, `${name} is in the spec but not in /metrics`).toContain(`# TYPE ${name} ${type}\n`);
      for (const label of [...labels.matchAll(/`(\w+)`/g)].map((m) => m[1])) {
        // Labels are only printed once there is a sample, so check the ones a review has produced.
        if (['reviews_total', 'http_requests_total', 'analyzer_duration_seconds', 'findings_total'].includes(name)) {
          expect(text, `${name} should carry the label ${label}`).toMatch(new RegExp(`^${name}\\w*\\{[^}]*\\b${label}="`, 'm'));
        }
      }
    }
  });

  it('/metrics: nothing printed in the spec is missing from the list, and nothing extra is listed', async () => {
    const text = (await request(app).get('/metrics')).text;
    const description: string = spec.paths['/metrics'].get.description;
    const listed = [...description.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]);
    const printed = [...text.matchAll(/^# TYPE (\w+) /gm)].map((m) => m[1]).filter((name) => !/^(process|nodejs)_/.test(name));

    expect(listed.sort()).toEqual(printed.sort());
  });

  it.runIf(ruffAvailable)('200: /ready when everything works', async () => {
    expectToMatchSpec('/ready', 'get', 200, await request(app).get('/ready'));
  });

  it('503: /ready when Ruff is missing', async () => {
    const broken = await loadApp({ RUFF_BIN: 'definitely-not-a-real-ruff' });

    expectToMatchSpec('/ready', 'get', 503, await request(broken).get('/ready'));
  });

  it('503: /ready when the model server is down', async () => {
    const broken = await loadApp({ LLM_ENABLED: 'true', OLLAMA_BASE_URL: 'http://127.0.0.1:9' });

    expectToMatchSpec('/ready', 'get', 503, await request(broken).get('/ready'));
  });
});