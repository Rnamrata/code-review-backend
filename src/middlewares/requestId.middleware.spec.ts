import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { attachRequestId } from './requestId.middleware';

// A tiny app that shows what the middleware leaves in res.locals.
const app = express();
app.get('/id', attachRequestId, (req, res) => {
  res.json({ requestId: res.locals.requestId });
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('attachRequestId', () => {
  it('generates an id when the caller sent none', async () => {
    const res = await request(app).get('/id');

    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('sends the same id in the header and keeps it in res.locals', async () => {
    const res = await request(app).get('/id');

    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('gives each request a different id', async () => {
    const first = await request(app).get('/id');
    const second = await request(app).get('/id');

    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('keeps an id the caller sent', async () => {
    const res = await request(app).get('/id').set('X-Request-Id', 'chatbot-42');

    expect(res.headers['x-request-id']).toBe('chatbot-42');
    expect(res.body.requestId).toBe('chatbot-42');
  });

  it.each(['a', 'A.b_c-1', '0123456789'])('accepts the id "%s"', async (id) => {
    const res = await request(app).get('/id').set('X-Request-Id', id);

    expect(res.headers['x-request-id']).toBe(id);
  });

  it('accepts an id of exactly 64 characters', async () => {
    const id = 'a'.repeat(64);

    const res = await request(app).get('/id').set('X-Request-Id', id);

    expect(res.headers['x-request-id']).toBe(id);
  });

  it.each([
    ['has spaces'],
    ['semi;colon'],
    ['<script>alert(1)</script>'],
    ['new\\nline'],
    ['x'.repeat(65)]
  ])('replaces an unsafe incoming id (%s)', async (incoming) => {
    const res = await request(app).get('/id').set('X-Request-Id', incoming);

    expect(res.headers['x-request-id']).not.toBe(incoming);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('calls the next handler', async () => {
    const res = await request(app).get('/id');

    expect(res.status).toBe(200);
  });
});