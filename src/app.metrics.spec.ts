import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The app reads its settings once, when it loads, so each test loads a fresh copy (and with it a
// fresh set of counters). Everything here goes through the real routes, as a scraper would.
const loadApp = async (env: Record<string, string> = {}) => {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return (await import('./app')).default;
};

// Reads a number out of the text GET /metrics prints: the line for `name` whose labels include `labels`.
const valueOf = (text: string, name: string, labels: Record<string, string> = {}): number => {
  let total = 0;
  for (const line of text.split('\n')) {
    const match = /^([a-zA-Z_:][\w:]*)(?:\{(.*)\})? (\S+)$/.exec(line);
    if (!match || match[1] !== name) continue;
    const found = Object.fromEntries([...(match[2] ?? '').matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    if (Object.entries(labels).every(([key, want]) => found[key] === want)) total += Number(match[3]);
  }
  return total;
};

const scrape = async (app: Awaited<ReturnType<typeof loadApp>>) => (await request(app).get('/metrics')).text;

const js = { filename: 'a.js', language: 'js', code: 'export function run(i) {\n  return eval(i);\n}\n' };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('GET /metrics', () => {
  it('answers 200 in the Prometheus text format', async () => {
    const res = await request(await loadApp()).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toContain('# TYPE http_requests_total counter');
  });

  it('includes the numbers of the Node process', async () => {
    expect(await scrape(await loadApp())).toContain('nodejs_eventloop_lag_seconds');
  });

  it('does not ask for a request id and does not send one', async () => {
    const res = await request(await loadApp()).get('/metrics');

    expect(res.headers['x-request-id']).toBeUndefined();
  });

  it('is gone (404) when METRICS_ENABLED=false', async () => {
    const res = await request(await loadApp({ METRICS_ENABLED: 'false' })).get('/metrics');

    expect(res.status).toBe(404);
  });

  it('is not behind the rate limit', async () => {
    const app = await loadApp({ RATE_LIMIT_MAX_REQUESTS: '1' });

    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await request(app).get('/metrics')).status);

    expect(statuses).toEqual([200, 200, 200, 200]);
  });
});

describe('what it counts', () => {
  it('counts a review: the request, the review, the analyzer and the findings', async () => {
    const app = await loadApp();

    await request(app).post('/review').send(js);
    const text = await scrape(app);

    expect(valueOf(text, 'http_requests_total', { method: 'POST', route: '/review', status: '200' })).toBe(1);
    expect(valueOf(text, 'reviews_total', { outcome: 'completed' })).toBe(1);
    expect(valueOf(text, 'review_duration_seconds_count')).toBe(1);
    expect(valueOf(text, 'analyzer_duration_seconds_count', { analyzer: 'eslint' })).toBe(1);
    expect(valueOf(text, 'findings_total', { source: 'eslint' })).toBeGreaterThan(0);
  });

  it('counts every review, not only the first', async () => {
    const app = await loadApp();

    for (let i = 0; i < 3; i++) await request(app).post('/review').send(js);

    expect(valueOf(await scrape(app), 'reviews_total', { outcome: 'completed' })).toBe(3);
  });

  it('counts a review nobody can do as unsupported_language', async () => {
    const app = await loadApp();

    await request(app).post('/review').send({ filename: 'A.java', language: 'java', code: 'class A {}\n' });
    const text = await scrape(app);

    expect(valueOf(text, 'reviews_total', { outcome: 'unsupported_language' })).toBe(1);
    expect(valueOf(text, 'reviews_total', { outcome: 'completed' })).toBe(0);
  });

  it('counts a review as partial when an analyzer failed, and says why', async () => {
    // The model is switched on but unreachable, so the llm analyzer fails and ESLint still answers.
    const app = await loadApp({ LLM_ENABLED: 'true', OLLAMA_BASE_URL: 'http://127.0.0.1:9' });

    const res = await request(app).post('/review').send(js);
    const text = await scrape(app);

    expect(res.body.warnings).toEqual([expect.objectContaining({ source: 'llm' })]);
    expect(valueOf(text, 'reviews_total', { outcome: 'partial' })).toBe(1);
    expect(valueOf(text, 'analyzer_failures_total', { analyzer: 'llm', reason: 'error' })).toBe(1);
    expect(valueOf(text, 'analyzer_failures_total', { analyzer: 'eslint' })).toBe(0);
  });

  it('counts a rejected request by its status', async () => {
    const app = await loadApp();

    await request(app).post('/review').send({ ...js, code: '' });
    const text = await scrape(app);

    expect(valueOf(text, 'http_requests_total', { route: '/review', status: '400' })).toBe(1);
    expect(valueOf(text, 'reviews_total')).toBe(0);
  });

  it('counts a body that is not valid JSON as a 400 on /review', async () => {
    const app = await loadApp();

    await request(app).post('/review').set('Content-Type', 'application/json').send('{bad json');

    expect(valueOf(await scrape(app), 'http_requests_total', { route: '/review', status: '400' })).toBe(1);
  });

  it('counts a refused request in the http numbers and in rate_limited_total', async () => {
    const app = await loadApp({ RATE_LIMIT_MAX_REQUESTS: '1' });

    await request(app).post('/review').send(js);
    await request(app).post('/review').send(js);
    const text = await scrape(app);

    expect(valueOf(text, 'rate_limited_total')).toBe(1);
    expect(valueOf(text, 'http_requests_total', { route: '/review', status: '429' })).toBe(1);
    expect(valueOf(text, 'reviews_total', { outcome: 'completed' })).toBe(1);
  });

  it('counts /health and /ready under their own routes', async () => {
    const app = await loadApp({ RUFF_BIN: 'definitely-not-a-real-ruff' });

    await request(app).get('/health');
    await request(app).get('/ready');
    const text = await scrape(app);

    expect(valueOf(text, 'http_requests_total', { route: '/health', status: '200' })).toBe(1);
    expect(valueOf(text, 'http_requests_total', { route: '/ready', status: '503' })).toBe(1);
  });

  it('counts a path that does not exist as "unmatched", however many different ones are asked for', async () => {
    const app = await loadApp();

    for (const path of ['/a', '/b', '/wp-admin', '/review/1', '/x?y=1']) await request(app).get(path);
    const text = await scrape(app);

    expect(valueOf(text, 'http_requests_total', { route: 'unmatched', status: '404' })).toBe(5);
    expect(text).not.toContain('wp-admin');
  });
});

describe('what it never shows', () => {
  it('does not put the filename, the code or the request id in a label', async () => {
    const app = await loadApp();

    await request(app)
      .post('/review')
      .set('X-Request-Id', 'secret-request-id-123')
      .send({ filename: 'customer-passwords.js', language: 'js', code: 'const apiKey = "sk-very-secret-value"; eval(apiKey);\n' });
    const text = await scrape(app);

    expect(text).not.toContain('customer-passwords');
    expect(text).not.toContain('sk-very-secret-value');
    expect(text).not.toContain('secret-request-id-123');
  });
});

describe('the access log', () => {
  it('is not written under test, like the morgan lines it replaced', async () => {
    const app = await loadApp({ NODE_ENV: 'test' });
    const { logger } = await import('./utils/logger.util');
    const log = vi.spyOn(logger, 'log').mockImplementation((() => logger) as never);

    await request(app).get('/health');

    expect(log.mock.calls.filter((call) => call[1] === 'HTTP request')).toHaveLength(0);
  });

  it('is written otherwise, one line for each answer', async () => {
    const app = await loadApp({ NODE_ENV: 'development' });
    const { logger } = await import('./utils/logger.util');
    const log = vi.spyOn(logger, 'log').mockImplementation((() => logger) as never);

    await request(app).post('/review').set('X-Request-Id', 'abc-9').send(js);

    const lines = log.mock.calls.filter((call) => call[1] === 'HTTP request');
    expect(lines).toHaveLength(1);
    expect(lines[0][2]).toMatchObject({ method: 'POST', path: '/review', status: 200, requestId: 'abc-9' });
  });

  it('logs a malformed body with its request id too', async () => {
    const app = await loadApp({ NODE_ENV: 'development' });
    const { logger } = await import('./utils/logger.util');
    const log = vi.spyOn(logger, 'log').mockImplementation((() => logger) as never);

    await request(app).post('/review').set('Content-Type', 'application/json').set('X-Request-Id', 'abc-10').send('{bad');

    const lines = log.mock.calls.filter((call) => call[1] === 'HTTP request');
    expect(lines[0][2]).toMatchObject({ status: 400, requestId: 'abc-10' });
  });

  it('logs /health at debug level so probes stay out of the way', async () => {
    const app = await loadApp({ NODE_ENV: 'development' });
    const { logger } = await import('./utils/logger.util');
    const log = vi.spyOn(logger, 'log').mockImplementation((() => logger) as never);

    await request(app).get('/health');
    await request(app).get('/metrics');

    const levels = log.mock.calls.filter((call) => call[1] === 'HTTP request').map((call) => call[0]);
    expect(levels).toEqual(['debug', 'debug']);
  });
});
