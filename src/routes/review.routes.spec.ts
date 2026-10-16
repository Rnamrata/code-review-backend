import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../app';
import { appConfig } from '../config/app.config';
import { reviewCode } from '../services/reviewOrchestrator.service';

// The orchestrator is replaced, so these tests are about the HTTP contract:
// what is accepted, what is rejected, and what is handed on.
vi.mock('../services/reviewOrchestrator.service', () => ({ reviewCode: vi.fn() }));
vi.mock('../utils/logger.util', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));
const reviewCodeMock = vi.mocked(reviewCode);

const emptyResult = {
  findings: [],
  warnings: [],
  summary: {
    total: 0,
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    bySource: {},
    byCategory: {}
  }
};

const valid = { filename: 'app.py', language: 'python', code: 'x = 1\n' };

const ONE_MB = 1024 * 1024;

// Pin the limits so a developer's .env cannot change these results.
const original = {
  allowedExtensions: appConfig.allowedExtensions,
  maxFileSizeMB: appConfig.maxFileSizeMB,
  nodeEnv: appConfig.nodeEnv
};

beforeEach(() => {
  vi.clearAllMocks();
  reviewCodeMock.mockResolvedValue(emptyResult);
  appConfig.allowedExtensions = ['.py', '.js', '.ts', '.jsx', '.tsx', '.java'];
  appConfig.maxFileSizeMB = 1;
});

afterEach(() => {
  appConfig.allowedExtensions = original.allowedExtensions;
  appConfig.maxFileSizeMB = original.maxFileSizeMB;
  appConfig.nodeEnv = original.nodeEnv;
});

describe('POST /review: request body', () => {
  it('rejects a request with no body', async () => {
    const res = await request(app).post('/review');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('rejects a body that is not JSON', async () => {
    const res = await request(app).post('/review').type('text/plain').send('hello');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('rejects malformed JSON without leaking a stack', async () => {
    const res = await request(app)
      .post('/review')
      .set('Content-Type', 'application/json')
      .send('{bad json');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body).not.toHaveProperty('stack');
  });

  it.each([
    ['an empty object', {}],
    ['an array', []],
    ['no filename', { language: 'python', code: 'x' }],
    ['no language', { filename: 'a.py', code: 'x' }],
    ['no code', { filename: 'a.py', language: 'python' }],
    ['a numeric filename', { filename: 42, language: 'python', code: 'x' }],
    ['a numeric language', { filename: 'a.py', language: 42, code: 'x' }],
    ['a numeric code', { filename: 'a.py', language: 'python', code: 42 }],
    ['null code', { filename: 'a.py', language: 'python', code: null }],
    ['a blank filename', { filename: '   ', language: 'python', code: 'x' }],
    ['a blank language', { filename: 'a.py', language: '   ', code: 'x' }]
  ])('rejects %s', async (_label, body) => {
    const res = await request(app).post('/review').send(body as object);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('does not call the orchestrator for an invalid request', async () => {
    await request(app).post('/review').send({ filename: 'a.py' });

    expect(reviewCodeMock).not.toHaveBeenCalled();
  });
});

describe('POST /review: file extension', () => {
  it.each(['notes.txt', 'Makefile', 'app.', 'app.py.txt', '.py', 'run.exe', 'module.pyc'])(
    'rejects "%s"',
    async (filename) => {
      const res = await request(app).post('/review').send({ ...valid, filename });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Unsupported file type');
    }
  );

  it('lists the allowed extensions in the message', async () => {
    const res = await request(app).post('/review').send({ ...valid, filename: 'a.txt' });

    expect(res.body.message).toContain('.py');
    expect(res.body.message).toContain('.js');
  });

  it('accepts an upper-case extension', async () => {
    const res = await request(app).post('/review').send({ ...valid, filename: 'APP.PY' });

    expect(res.status).toBe(200);
  });
});

describe('POST /review: code size', () => {
  it('rejects empty code', async () => {
    const res = await request(app).post('/review').send({ ...valid, code: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid code size');
  });

  it('accepts a single byte', async () => {
    const res = await request(app).post('/review').send({ ...valid, code: 'x' });

    expect(res.status).toBe(200);
  });

  it('accepts code of exactly the limit', async () => {
    const res = await request(app).post('/review').send({ ...valid, code: 'x'.repeat(ONE_MB) });

    expect(res.status).toBe(200);
  });

  it('rejects code one byte over the limit', async () => {
    const res = await request(app).post('/review').send({ ...valid, code: 'x'.repeat(ONE_MB + 1) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid code size');
  });

  it('counts bytes, not characters', async () => {
    // 400,000 characters, but 1,200,000 bytes in UTF-8.
    const res = await request(app).post('/review').send({ ...valid, code: '€'.repeat(400_000) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid code size');
  });

  it('rejects a body larger than the JSON limit with 413', async () => {
    const res = await request(app)
      .post('/review')
      .send({ ...valid, code: 'x'.repeat(3 * ONE_MB) });

    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
  });

  it('does not call the orchestrator for oversized code', async () => {
    await request(app).post('/review').send({ ...valid, code: 'x'.repeat(ONE_MB + 1) });

    expect(reviewCodeMock).not.toHaveBeenCalled();
  });
});

describe('POST /review: what the orchestrator receives', () => {
  it('receives the cleaned-up request', async () => {
    await request(app)
      .post('/review')
      .send({ filename: 'my file.py', language: 'Python', code: '  x = 1\r\n\r\n' });

    expect(reviewCodeMock).toHaveBeenCalledTimes(1);
    expect(reviewCodeMock).toHaveBeenCalledWith({
      filename: 'my file.py',
      safeFilename: 'my_file.py',
      language: 'python',
      code: '  x = 1\r\n\r\n'
    });
  });

  it('trims the filename it reports but leaves the code alone', async () => {
    await request(app).post('/review').send({ ...valid, filename: ' app.py', code: '\n\n x \n' });

    const received = reviewCodeMock.mock.calls[0][0];
    expect(received.filename).toBe('app.py');
    expect(received.code).toBe('\n\n x \n');
  });

  it('turns a language alias into the canonical name', async () => {
    await request(app).post('/review').send({ filename: 'a.js', language: 'JS', code: 'x' });

    expect(reviewCodeMock.mock.calls[0][0].language).toBe('javascript');
  });

  it('falls back to the extension when the language is unknown', async () => {
    await request(app).post('/review').send({ filename: 'a.py', language: 'cobol', code: 'x' });

    expect(reviewCodeMock.mock.calls[0][0].language).toBe('python');
  });

  it('keeps an unknown language as given when the extension tells nothing', async () => {
    appConfig.allowedExtensions = ['.rb'];

    await request(app).post('/review').send({ filename: 'a.rb', language: 'Ruby', code: 'x' });

    expect(reviewCodeMock.mock.calls[0][0].language).toBe('ruby');
  });

  it('sanitizes the name used for paths without changing the reported one', async () => {
    await request(app)
      .post('/review')
      .send({ filename: 'src/utils/app.py', language: 'python', code: 'x' });

    const received = reviewCodeMock.mock.calls[0][0];
    expect(received.filename).toBe('src/utils/app.py');
    expect(received.safeFilename).toBe('src_utils_app.py');
  });
});

describe('POST /review: response', () => {
  it('returns exactly what the orchestrator produced', async () => {
    const result = {
      findings: [
        { file: 'app.py', line: 2, message: 'unsafe (S307)', severity: 'high', category: 'security', source: 'ruff' }
      ],
      warnings: [{ source: 'eslint', message: 'something failed' }],
      summary: {
        total: 1,
        bySeverity: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
        bySource: { ruff: 1 },
        byCategory: { security: 1 }
      }
    };
    reviewCodeMock.mockResolvedValue(result as never);

    const res = await request(app).post('/review').send(valid);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(result);
  });

  it('keeps findings at the top level, with no wrapper', async () => {
    const res = await request(app).post('/review').send(valid);

    expect(Array.isArray(res.body.findings)).toBe(true);
    expect(res.body).not.toHaveProperty('data');
    expect(res.body).not.toHaveProperty('success');
  });

  it('answers with JSON', async () => {
    const res = await request(app).post('/review').send(valid);

    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('answers 500 without leaking details when the orchestrator throws', async () => {
    appConfig.nodeEnv = 'production';
    reviewCodeMock.mockRejectedValue(new Error('db password is hunter2 at /srv/app'));

    const res = await request(app).post('/review').send(valid);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    expect(res.body).not.toHaveProperty('stack');
  });
});

describe('routing and headers', () => {
  it('serves /review at the root, not under /api', async () => {
    const res = await request(app).post('/api/review').send(valid);

    expect(res.status).toBe(404);
  });

  it('only accepts POST on /review', async () => {
    const res = await request(app).get('/review');

    expect(res.status).toBe(404);
  });

  it('answers unknown routes with a 404 that names the route', async () => {
    const res = await request(app).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found', message: 'Cannot GET /nope' });
  });

  it('answers /health with a status and an ISO timestamp', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });

  it('does not advertise the framework', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sets the content-type-options security header', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});