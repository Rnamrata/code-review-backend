import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfig } from '../config/app.config';
import { logger } from '../utils/logger.util';
import { errorHandler } from './errorHandler.middleware';

// Keep test output clean and make sure nothing is written to log files.
vi.mock('../utils/logger.util', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

interface Captured {
  status: number;
  body: any;
}

// Runs the handler with a fake request and response and returns what it sent.
function run(error: any): Captured {
  const captured: Captured = { status: 0, body: undefined };
  const res: any = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(body: any) {
      captured.body = body;
      return res;
    }
  };
  const req: any = { path: '/review', method: 'POST' };

  errorHandler(error, req, res, () => undefined);
  return captured;
}

const clientError = (status: number, message: string, key: 'statusCode' | 'status' = 'statusCode') => {
  const error: any = new Error(message);
  error[key] = status;
  return error;
};

const original = appConfig.nodeEnv;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  appConfig.nodeEnv = original;
});

describe('errorHandler', () => {
  describe('client errors (4xx)', () => {
    it('keeps the status and the message', () => {
      appConfig.nodeEnv = 'production';

      const { status, body } = run(clientError(413, 'request entity too large'));

      expect(status).toBe(413);
      expect(body.error).toBe('request entity too large');
    });

    it('reads the status from `status` when `statusCode` is missing', () => {
      appConfig.nodeEnv = 'production';

      const { status } = run(clientError(400, 'bad json', 'status'));

      expect(status).toBe(400);
    });

    it('does not include a stack in production', () => {
      appConfig.nodeEnv = 'production';

      const { body } = run(clientError(400, 'bad json'));

      expect(body).not.toHaveProperty('stack');
    });
  });

  describe('server errors (5xx) in production', () => {
    const secret = new Error('db password is hunter2 at /srv/app/secret.ts');

    it('answers 500 when the error carries no status', () => {
      appConfig.nodeEnv = 'production';

      expect(run(secret).status).toBe(500);
    });

    it('hides the real message behind a generic one', () => {
      appConfig.nodeEnv = 'production';

      const { body } = run(secret);

      expect(body.error).toBe('Internal server error');
      expect(JSON.stringify(body)).not.toContain('hunter2');
      expect(JSON.stringify(body)).not.toContain('/srv/app');
    });

    it('does not include a stack', () => {
      appConfig.nodeEnv = 'production';

      expect(run(secret).body).not.toHaveProperty('stack');
    });

    it('hides the message of an explicit 5xx status too', () => {
      appConfig.nodeEnv = 'production';

      const { status, body } = run(clientError(503, 'upstream credentials rejected'));

      expect(status).toBe(503);
      expect(body.error).toBe('Internal server error');
    });

    it('does the same when NODE_ENV is "test"', () => {
      appConfig.nodeEnv = 'test';

      const { body } = run(secret);

      expect(body.error).toBe('Internal server error');
      expect(body).not.toHaveProperty('stack');
    });
  });

  describe('in development', () => {
    it('returns the real message of a server error', () => {
      appConfig.nodeEnv = 'development';

      const { body } = run(new Error('db password is hunter2'));

      expect(body.error).toBe('db password is hunter2');
    });

    it('returns the stack in its own field, never in `message`', () => {
      appConfig.nodeEnv = 'development';

      const { body } = run(new Error('boom'));

      expect(body.stack).toContain('boom');
      expect(body.message).toBeUndefined();
    });
  });

  describe('response shape', () => {
    it('uses the standard error body', () => {
      appConfig.nodeEnv = 'production';

      const { body } = run(clientError(400, 'bad'));

      expect(body.success).toBe(false);
      expect(typeof body.timestamp).toBe('string');
    });

    it('falls back to a message when the error has none', () => {
      appConfig.nodeEnv = 'production';

      const { body } = run(clientError(400, ''));

      expect(body.error).toBeTruthy();
    });
  });

  describe('logging', () => {
    it('always logs the full error with its stack, even in production', () => {
      appConfig.nodeEnv = 'production';
      const error = new Error('db password is hunter2');

      run(error);

      expect(logger.error).toHaveBeenCalledTimes(1);
      const [, details] = (logger.error as any).mock.calls[0];
      expect(details.error).toBe('db password is hunter2');
      expect(details.stack).toContain('hunter2');
      expect(details.path).toBe('/review');
      expect(details.method).toBe('POST');
    });
  });
});