import { spawnSync } from 'child_process';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The app reads its settings once, when it loads, so each test sets the environment it needs
// and loads a fresh copy of the app.
const loadApp = async (env: Record<string, string> = {}) => {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return (await import('./app')).default;
};

const validBody = { filename: 'a.js', language: 'js', code: 'export const a = 1;\n' };
const ruffAvailable = spawnSync('ruff', ['--version']).status === 0;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('rate limiting', () => {
  it('answers 429 to a client that passes the limit on /review', async () => {
    const app = await loadApp({ RATE_LIMIT_MAX_REQUESTS: '2' });

    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await request(app).post('/review').send(validBody)).status);

    expect(statuses).toEqual([200, 200, 429]);
  });

  it('uses the standard error shape for a refused request', async () => {
    const app = await loadApp({ RATE_LIMIT_MAX_REQUESTS: '1' });
    await request(app).post('/review').send(validBody);

    const res = await request(app).post('/review').send(validBody);

    expect(res.body).toMatchObject({ success: false, error: 'Too many requests' });
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('counts rejected requests too, so a client cannot probe without limit', async () => {
    const app = await loadApp({ RATE_LIMIT_MAX_REQUESTS: '2' });

    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await request(app).post('/review').send({})).status);

    expect(statuses).toEqual([400, 400, 429]);
  });

  it('leaves /health alone once the limit is reached', async () => {
    const app = await loadApp({ RATE_LIMIT_MAX_REQUESTS: '1' });
    await request(app).post('/review').send(validBody);
    await request(app).post('/review').send(validBody);

    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('leaves /ready alone once the limit is reached', async () => {
    const app = await loadApp({ RATE_LIMIT_MAX_REQUESTS: '1' });
    await request(app).post('/review').send(validBody);
    await request(app).post('/review').send(validBody);

    expect((await request(app).get('/ready')).status).not.toBe(429);
  });

  it('uses a 15 minute window by default', async () => {
    const app = await loadApp({ RATE_LIMIT_WINDOW_MINUTES: '' });

    const res = await request(app).post('/review').send(validBody);

    expect(res.headers['ratelimit-policy']).toContain('w=900');
  });

  it('follows RATE_LIMIT_WINDOW_MINUTES', async () => {
    const app = await loadApp({ RATE_LIMIT_WINDOW_MINUTES: '2' });

    const res = await request(app).post('/review').send(validBody);

    expect(res.headers['ratelimit-policy']).toContain('w=120');
  });

  it('follows RATE_LIMIT_MAX_REQUESTS', async () => {
    const app = await loadApp({ RATE_LIMIT_MAX_REQUESTS: '4' });

    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await request(app).post('/review').send(validBody)).status);

    expect(statuses).toEqual([200, 200, 200, 200, 429]);
  });
});

describe('CORS', () => {
  it('allows no browser origin by default', async () => {
    const app = await loadApp();

    const res = await request(app).get('/health').set('Origin', 'http://evil.test');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows the origin set in CORS_ORIGIN', async () => {
    const app = await loadApp({ CORS_ORIGIN: 'http://chat.test' });

    const res = await request(app).get('/health').set('Origin', 'http://chat.test');

    expect(res.headers['access-control-allow-origin']).toBe('http://chat.test');
  });

  it('refuses to start with "*" in production', async () => {
    await expect(loadApp({ NODE_ENV: 'production', CORS_ORIGIN: '*' })).rejects.toThrow(/CORS_ORIGIN/);
  });

  it('starts with a real origin in production', async () => {
    const app = await loadApp({ NODE_ENV: 'production', CORS_ORIGIN: 'https://chat.example.com' });

    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('still allows "*" in development', async () => {
    const app = await loadApp({ NODE_ENV: 'development', CORS_ORIGIN: '*' });

    const res = await request(app).get('/health').set('Origin', 'http://anything.test');

    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

describe('request body limit', () => {
  const ONE_MB = 1024 * 1024;

  it('grows with MAX_FILE_SIZE_MB: code over the file limit is refused as invalid, not as too large', async () => {
    const app = await loadApp({ MAX_FILE_SIZE_MB: '3' });

    const res = await request(app)
      .post('/review')
      .send({ ...validBody, code: 'x'.repeat(4 * ONE_MB) });

    expect(res.status).toBe(400);
  });

  it('still refuses a body larger than twice the file limit with 413', async () => {
    const app = await loadApp({ MAX_FILE_SIZE_MB: '3' });

    const res = await request(app)
      .post('/review')
      .send({ ...validBody, code: 'x'.repeat(7 * ONE_MB) });

    expect(res.status).toBe(413);
  });
});

describe('/ready', () => {
  it.runIf(ruffAvailable)('says the service is ready when Ruff is installed and the LLM is off', async () => {
    const app = await loadApp();

    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.checks.ruff.ok).toBe(true);
  });

  it('answers 503 when Ruff is missing', async () => {
    const app = await loadApp({ RUFF_BIN: 'definitely-not-a-real-ruff' });

    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body.ready).toBe(false);
    expect(res.body.checks.ruff.ok).toBe(false);
  });

  it('answers 503 when the LLM is on and Ollama is down', async () => {
    const app = await loadApp({ LLM_ENABLED: 'true', OLLAMA_BASE_URL: 'http://127.0.0.1:9' });

    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body.checks.ollama).toEqual({ ok: false, detail: 'Ollama is unreachable' });
  });

  it('keeps /health cheap: it is healthy even when the readiness checks fail', async () => {
    const app = await loadApp({ RUFF_BIN: 'definitely-not-a-real-ruff' });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });
});
