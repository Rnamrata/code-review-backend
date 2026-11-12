import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accessLog } from './accessLog.middleware';
import { logger } from '../utils/logger.util';

const log = vi.spyOn(logger, 'log').mockImplementation((() => logger) as never);

// A tiny app with only this middleware. The route sets a request id the way attachRequestId does.
const makeApp = () => {
  const app = express();
  app.use(accessLog);
  app.get('/health', (_req, res) => void res.json({ ok: true }));
  app.post('/review', (_req, res) => {
    res.locals.requestId = 'req-1';
    res.status(201).json({ ok: true });
  });
  app.get('/boom', (_req, res) => void res.status(500).json({ ok: false }));
  return app;
};

beforeEach(() => {
  log.mockClear();
});

describe('accessLog', () => {
  it('logs one line per answer, with fields instead of a sentence', async () => {
    await request(makeApp()).post('/review').send({ code: 'secret = 1' });

    expect(log).toHaveBeenCalledTimes(1);
    const [level, message, fields] = log.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(level).toBe('info');
    expect(message).toBe('HTTP request');
    expect(fields).toMatchObject({ method: 'POST', path: '/review', status: 201, requestId: 'req-1' });
    expect(typeof fields.durationMs).toBe('number');
  });

  it('logs the time in milliseconds with at most two decimals', async () => {
    await request(makeApp()).post('/review').send({});

    const fields = log.mock.calls[0][2] as { durationMs: number };
    expect(fields.durationMs).toBeGreaterThanOrEqual(0);
    expect(fields.durationMs).toBeLessThan(5000);
    expect(Number(fields.durationMs.toFixed(2))).toBe(fields.durationMs);
  });

  it('leaves the request id out of a route that has none', async () => {
    await request(makeApp()).get('/boom');

    const fields = log.mock.calls[0][2] as Record<string, unknown>;
    expect(fields.requestId).toBeUndefined();
    expect(fields.status).toBe(500);
  });

  it.each(['/health', '/ready', '/metrics'])('logs %s at debug level, so probes stay quiet', async (path) => {
    const app = express();
    app.use(accessLog);
    app.get(path, (_req, res) => void res.json({}));

    await request(app).get(path);

    expect(log.mock.calls[0][0]).toBe('debug');
  });

  it('logs a probe that fails at debug level too, with its status', async () => {
    const app = express();
    app.use(accessLog);
    app.get('/ready', (_req, res) => void res.status(503).json({}));

    await request(app).get('/ready');

    expect(log.mock.calls[0][2]).toMatchObject({ status: 503 });
  });

  it('leaves the query string out of the path', async () => {
    await request(makeApp()).get('/health?token=abc123');

    expect((log.mock.calls[0][2] as { path: string }).path).toBe('/health');
    expect(JSON.stringify(log.mock.calls)).not.toContain('abc123');
  });

  it('never logs the body', async () => {
    await request(makeApp()).post('/review').send({ code: 'password = "hunter2"' });

    expect(JSON.stringify(log.mock.calls)).not.toContain('hunter2');
  });
});
