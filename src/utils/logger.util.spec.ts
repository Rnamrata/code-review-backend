import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger, logPerformance } from './logger.util';

describe('logPerformance', () => {
  // Intercept the logger so nothing is printed or written.
  const log = vi.spyOn(logger, 'log').mockImplementation((() => logger) as never);

  beforeEach(() => {
    log.mockClear();
  });

  afterEach(() => {
    log.mockClear();
  });

  it('logs a fast operation at debug level', () => {
    logPerformance('parse', 200);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe('debug');
  });

  it('logs an operation slower than one second as a warning by default', () => {
    logPerformance('parse', 1500);

    expect(log.mock.calls[0][0]).toBe('warn');
  });

  it('treats exactly the threshold as not slow', () => {
    logPerformance('parse', 1000);

    expect(log.mock.calls[0][0]).toBe('debug');
  });

  it('lets the caller choose what counts as slow', () => {
    logPerformance('llm call', 5000, undefined, 10_000);
    logPerformance('llm call', 12_000, undefined, 10_000);

    expect(log.mock.calls[0][0]).toBe('debug');
    expect(log.mock.calls[1][0]).toBe('warn');
  });

  it('records the operation, the duration and any extra context', () => {
    logPerformance('analyzer ruff', 42, { requestId: 'req-1' });

    const [, message, details] = log.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(message).toContain('analyzer ruff');
    expect(details).toMatchObject({ operation: 'analyzer ruff', duration: '42ms', requestId: 'req-1' });
  });
});