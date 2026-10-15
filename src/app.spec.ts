import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from './app';

describe('app', () => {
  it('answers /health without starting a listener', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  it('reviews python code and keeps findings top-level', async () => {
    const res = await request(app)
      .post('/review')
      .send({ filename: 'a.py', language: 'py', code: 'import os\n' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.findings)).toBe(true);
    expect(res.body.findings[0]).toMatchObject({ file: 'a.py', source: 'ruff' });
  });

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