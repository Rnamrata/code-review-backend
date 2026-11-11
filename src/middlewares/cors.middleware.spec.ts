import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createCors, resolveCorsOrigins } from './cors.middleware';

describe('resolveCorsOrigins', () => {
  it.each([[''], ['   '], [','], [' , ,']])('allows no browser origin for "%s"', (value) => {
    expect(resolveCorsOrigins(value, 'development')).toBe(false);
  });

  it('returns a single origin as a list', () => {
    expect(resolveCorsOrigins('http://localhost:4200', 'production')).toEqual(['http://localhost:4200']);
  });

  it('splits a comma separated list and trims each origin', () => {
    expect(resolveCorsOrigins(' http://a.test , http://b.test ,, ', 'production')).toEqual([
      'http://a.test',
      'http://b.test'
    ]);
  });

  it.each(['development', 'test'])('allows "*" in %s', (env) => {
    expect(resolveCorsOrigins('*', env)).toBe('*');
  });

  it('refuses "*" in production', () => {
    expect(() => resolveCorsOrigins('*', 'production')).toThrow(/must not be "\*" in production/);
  });

  it('refuses "*" in production even when it is one of several origins', () => {
    expect(() => resolveCorsOrigins('http://a.test, *', 'production')).toThrow(/CORS_ORIGIN/);
  });

  it('accepts a list of real origins in production', () => {
    expect(resolveCorsOrigins('https://chat.example.com', 'production')).toEqual(['https://chat.example.com']);
  });
});

describe('createCors', () => {
  const appWith = (value: string, env = 'development') => {
    const app = express();
    app.use(createCors(value, env));
    app.get('/x', (req, res) => {
      res.json({ ok: true });
    });
    app.post('/x', (req, res) => {
      res.json({ ok: true });
    });
    return app;
  };

  it('sends no CORS headers when no origin is configured', async () => {
    const res = await request(appWith('')).get('/x').set('Origin', 'http://evil.test');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows a configured origin', async () => {
    const res = await request(appWith('http://chat.test')).get('/x').set('Origin', 'http://chat.test');

    expect(res.headers['access-control-allow-origin']).toBe('http://chat.test');
  });

  it('does not allow an origin that is not configured', async () => {
    const res = await request(appWith('http://chat.test')).get('/x').set('Origin', 'http://evil.test');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows each origin of a list', async () => {
    const app = appWith('http://a.test,http://b.test');

    const a = await request(app).get('/x').set('Origin', 'http://a.test');
    const b = await request(app).get('/x').set('Origin', 'http://b.test');

    expect(a.headers['access-control-allow-origin']).toBe('http://a.test');
    expect(b.headers['access-control-allow-origin']).toBe('http://b.test');
  });

  it('allows any origin when "*" is configured outside production', async () => {
    const res = await request(appWith('*')).get('/x').set('Origin', 'http://anything.test');

    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('refuses to be created with "*" in production', () => {
    expect(() => createCors('*', 'production')).toThrow(/CORS_ORIGIN/);
  });

  it('answers a preflight request for an allowed origin', async () => {
    const res = await request(appWith('http://chat.test'))
      .options('/x')
      .set('Origin', 'http://chat.test')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toMatch(/content-type/i);
  });

  it('does not allow DELETE or PUT', async () => {
    const res = await request(appWith('http://chat.test'))
      .options('/x')
      .set('Origin', 'http://chat.test')
      .set('Access-Control-Request-Method', 'DELETE');

    expect(res.headers['access-control-allow-methods']).not.toMatch(/DELETE|PUT/);
  });

  it('lets a browser read the request id header', async () => {
    const res = await request(appWith('http://chat.test')).get('/x').set('Origin', 'http://chat.test');

    expect(res.headers['access-control-expose-headers']).toMatch(/X-Request-Id/i);
  });

  it('does not allow credentials', async () => {
    const res = await request(appWith('http://chat.test')).get('/x').set('Origin', 'http://chat.test');

    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});
