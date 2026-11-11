import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logSecurity } from '../utils/logger.util';
import { createRateLimiter } from './rateLimit.middleware';

vi.mock('../utils/logger.util', () => ({ logSecurity: vi.fn() }));

const appWith = (max: number, windowMs = 60_000) => {
  const app = express();
  app.set('trust proxy', true); // so a test can pretend to be different clients
  app.use('/limited', createRateLimiter({ windowMs, max }), (req, res) => {
    res.json({ ok: true });
  });
  app.get('/free', (req, res) => {
    res.json({ ok: true });
  });
  return app;
};

beforeEach(() => {
  vi.mocked(logSecurity).mockClear();
});

describe('createRateLimiter', () => {
  it('lets requests through up to the limit', async () => {
    const app = appWith(3);

    for (let i = 0; i < 3; i++) {
      expect((await request(app).get('/limited')).status).toBe(200);
    }
  });

  it('answers 429 once the limit is passed', async () => {
    const app = appWith(2);
    await request(app).get('/limited');
    await request(app).get('/limited');

    const res = await request(app).get('/limited');

    expect(res.status).toBe(429);
  });

  it('uses the standard error shape', async () => {
    const app = appWith(1);
    await request(app).get('/limited');

    const res = await request(app).get('/limited');

    expect(res.body).toMatchObject({ success: false, error: 'Too many requests' });
    expect(res.body.message).toMatch(/try again later/i);
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('tells the caller when to retry', async () => {
    const app = appWith(1);
    await request(app).get('/limited');

    const res = await request(app).get('/limited');

    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('sends the standard rate limit headers', async () => {
    const res = await request(appWith(5)).get('/limited');

    expect(res.headers['ratelimit']).toBeDefined();
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  it('does not send the old X-RateLimit headers', async () => {
    const res = await request(appWith(5)).get('/limited');

    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('counts each client address separately', async () => {
    const app = appWith(1);
    await request(app).get('/limited').set('X-Forwarded-For', '10.0.0.1');

    const sameClient = await request(app).get('/limited').set('X-Forwarded-For', '10.0.0.1');
    const otherClient = await request(app).get('/limited').set('X-Forwarded-For', '10.0.0.2');

    expect(sameClient.status).toBe(429);
    expect(otherClient.status).toBe(200);
  });

  it('only limits the routes it is attached to', async () => {
    const app = appWith(1);
    await request(app).get('/limited');
    await request(app).get('/limited');

    expect((await request(app).get('/free')).status).toBe(200);
  });

  it('allows requests again after the window passes', async () => {
    const app = appWith(1, 150);
    await request(app).get('/limited');
    expect((await request(app).get('/limited')).status).toBe(429);

    await new Promise((resolve) => setTimeout(resolve, 250));

    expect((await request(app).get('/limited')).status).toBe(200);
  });

  it('logs a security event when a request is refused', async () => {
    const app = appWith(1);
    await request(app).get('/limited').set('X-Forwarded-For', '10.0.0.9');
    await request(app).get('/limited').set('X-Forwarded-For', '10.0.0.9');

    expect(logSecurity).toHaveBeenCalledTimes(1);
    expect(logSecurity).toHaveBeenCalledWith(
      'rate_limit_exceeded',
      expect.objectContaining({ ip: '10.0.0.9', method: 'GET', path: '/limited' })
    );
  });

  it('does not log anything for requests that are allowed', async () => {
    await request(appWith(5)).get('/limited');

    expect(logSecurity).not.toHaveBeenCalled();
  });
});
