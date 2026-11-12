import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logSecurity } from '../utils/logger.util';
import { attachRequestId } from './requestId.middleware';
import { validateReview } from './validateReview.middleware';

vi.mock('../utils/logger.util', () => ({ logSecurity: vi.fn() }));

const valid = { filename: 'app.py', language: 'python', code: 'x = 1\n' };

// The same order as the real route: id first, then validation, then a handler that shows what it got.
const app = express();
app.use(express.json());
app.post('/review', attachRequestId, validateReview, (req, res) => {
  res.json({ received: req.body });
});

beforeEach(() => {
  vi.mocked(logSecurity).mockClear();
});

describe('validateReview with a good body', () => {
  it('hands the request on', async () => {
    const res = await request(app).post('/review').send(valid);

    expect(res.status).toBe(200);
  });

  it('hands on only the three known fields', async () => {
    const res = await request(app).post('/review').send({ ...valid, admin: true });

    expect(res.body.received).toEqual(valid);
  });

  it('logs nothing', async () => {
    await request(app).post('/review').send(valid);

    expect(logSecurity).not.toHaveBeenCalled();
  });
});

describe('validateReview with a bad body', () => {
  it('answers 400 in the standard error shape', async () => {
    const res = await request(app).post('/review').send({ filename: 'a.py' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Invalid request',
      message: 'Body must be JSON: { filename, language, code } (all strings)'
    });
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('does not hand the request on', async () => {
    const res = await request(app).post('/review').send({ filename: 'a.py' });

    expect(res.body.received).toBeUndefined();
  });

  it('still carries the request id, because it runs after attachRequestId', async () => {
    const res = await request(app).post('/review').set('X-Request-Id', 'chatbot-7').send({});

    expect(res.status).toBe(400);
    expect(res.headers['x-request-id']).toBe('chatbot-7');
  });

  it('explains an unsupported file type', async () => {
    const res = await request(app).post('/review').send({ ...valid, filename: 'a.exe' });

    expect(res.body.error).toBe('Unsupported file type');
    expect(res.body.message).toMatch(/^Allowed extensions: /);
  });

  it('explains code of the wrong size', async () => {
    const res = await request(app).post('/review').send({ ...valid, code: '' });

    expect(res.body.error).toBe('Invalid code size');
  });

  it('logs a security event with the request id and the reason', async () => {
    await request(app).post('/review').set('X-Request-Id', 'chatbot-7').send({ ...valid, filename: 'a.exe' });

    expect(logSecurity).toHaveBeenCalledTimes(1);
    expect(logSecurity).toHaveBeenCalledWith(
      'invalid_request',
      expect.objectContaining({ requestId: 'chatbot-7', reason: 'Unsupported file type' })
    );
  });

  it('logs the address of the caller', async () => {
    await request(app).post('/review').send({});

    expect(logSecurity).toHaveBeenCalledWith('invalid_request', expect.objectContaining({ ip: expect.any(String) }));
  });

  it('does not put the submitted code or file name in the log', async () => {
    await request(app).post('/review').send({ filename: 'secret-name.exe', language: 'python', code: 'password = 1' });

    expect(JSON.stringify(vi.mocked(logSecurity).mock.calls)).not.toMatch(/secret-name|password/);
  });
});

// Calls the middleware directly with stand-ins, to see exactly what it does with `next`.
describe('validateReview and the next handler', () => {
  const run = (body: unknown) => {
    const next = vi.fn();
    const res: any = { locals: { requestId: 'req-1' }, status: vi.fn().mockReturnThis(), json: vi.fn() };
    validateReview({ body, ip: '10.0.0.1' } as any, res, next);
    return { next, res };
  };

  it('calls next once for an acceptable body, and does not answer itself', () => {
    const { next, res } = run(valid);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('never calls next for a body that is rejected, so the controller cannot run on it', () => {
    for (const body of [undefined, {}, { ...valid, filename: 'a.exe' }, { ...valid, code: '' }]) {
      const { next } = run(body);

      expect(next).not.toHaveBeenCalled();
    }
  });

  it('answers a rejected body exactly once, with 400', () => {
    const { res } = run({});

    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledTimes(1);
  });
});