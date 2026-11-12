import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { recordMetrics } from './metrics.middleware';
import { metrics, registry } from '../services/metrics.service';

// Reads one number back out of the registry: the sample of `metricName` whose labels include `labels`.
const sample = async (metricName: string, labels: Record<string, string> = {}): Promise<number> => {
  const all = (await registry.getMetricsAsJSON()) as { values: { metricName?: string; labels: Record<string, string>; value: number }[]; name: string }[];
  const values = all.flatMap((metric) => metric.values.map((v) => ({ ...v, metricName: v.metricName ?? metric.name })));
  return values
    .filter((v) => v.metricName === metricName && Object.entries(labels).every(([k, want]) => v.labels[k] === want))
    .reduce((sum, v) => sum + v.value, 0);
};

// A tiny app with only this middleware, so the test is about what it counts and nothing else.
const makeApp = () => {
  const app = express();
  app.use(recordMetrics);
  app.get('/health', (_req, res) => void res.json({ ok: true }));
  app.post('/review', (_req, res) => void res.status(400).json({ ok: false }));
  app.get('/boom', (_req, res) => void res.status(500).json({ ok: false }));
  return app;
};

beforeEach(() => {
  metrics.reset();
});

describe('recordMetrics', () => {
  it('counts an answer with its method, route and status', async () => {
    const app = makeApp();

    await request(app).get('/health');
    await request(app).post('/review').send({});

    expect(await sample('http_requests_total', { method: 'GET', route: '/health', status: '200' })).toBe(1);
    expect(await sample('http_requests_total', { method: 'POST', route: '/review', status: '400' })).toBe(1);
  });

  it('counts a server error too', async () => {
    await request(makeApp()).get('/boom');

    expect(await sample('http_requests_total', { status: '500' })).toBe(1);
  });

  it('counts a route that does not exist as "unmatched"', async () => {
    await request(makeApp()).get('/nothing-here');

    expect(await sample('http_requests_total', { route: 'unmatched', status: '404' })).toBe(1);
  });

  it('leaves the query string out of the route', async () => {
    await request(makeApp()).get('/health?secret=abc&token=xyz');

    expect(await sample('http_requests_total', { route: '/health' })).toBe(1);
    expect(await metrics.render()).not.toContain('secret');
  });

  it('keeps the time the answer took', async () => {
    await request(makeApp()).get('/health');

    expect(await sample('http_request_duration_seconds_count', { route: '/health' })).toBe(1);
    expect(await sample('http_request_duration_seconds_sum', { route: '/health' })).toBeGreaterThan(0);
    expect(await sample('http_request_duration_seconds_sum', { route: '/health' })).toBeLessThan(5);
  });

  it('does not change the answer', async () => {
    const res = await request(makeApp()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
