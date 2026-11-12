import { afterEach, describe, expect, it, vi } from 'vitest';

// The logger reads its settings when it is loaded, so each test sets them and loads a fresh copy.
// Winston hands every transport the line it has formatted under Symbol.for('message'). A spy on
// the transport's `log` sees that line without anything being printed.
const MESSAGE = Symbol.for('message');

const load = async (env: Record<string, string>) => {
  vi.resetModules();
  vi.stubEnv('LOG_FORMAT', '');
  vi.stubEnv('LOG_TO_FILE', 'false');
  vi.stubEnv('LOG_TO_CONSOLE', 'true');
  vi.stubEnv('LOG_LEVEL', 'debug');
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);

  const module = await import('./logger.util');
  const lines: string[] = [];
  for (const transport of module.logger.transports) {
    vi.spyOn(transport, 'log').mockImplementation(((info: Record<symbol, string>, next?: () => void) => {
      lines.push(info[MESSAGE]);
      next?.();
    }) as never);
  }
  return { ...module, lines };
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('LOG_FORMAT=json', () => {
  it('prints one JSON object per line', async () => {
    const { logger, lines } = await load({ LOG_FORMAT: 'json' });

    logger.info('hello');

    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0])).not.toThrow();
    expect(lines[0]).not.toContain('\n');
  });

  it('has the level, the message and an ISO 8601 timestamp in UTC', async () => {
    const { logger, lines } = await load({ LOG_FORMAT: 'json' });

    logger.warn('careful');

    const line = JSON.parse(lines[0]);
    expect(line).toMatchObject({ level: 'warn', message: 'careful' });
    expect(line.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('puts the fields of a log call at the top level, not under "metadata"', async () => {
    const { logger, lines } = await load({ LOG_FORMAT: 'json' });

    logger.info('Review requested', { filename: 'a.js', language: 'js' });

    const line = JSON.parse(lines[0]);
    expect(line).toMatchObject({ filename: 'a.js', language: 'js' });
    expect(line).not.toHaveProperty('metadata');
  });

  it('puts the fields of a child logger at the top level too', async () => {
    const { createChildLogger, lines } = await load({ LOG_FORMAT: 'json' });

    createChildLogger({ requestId: 'req-7' }).info('hi', { extra: 1 });

    expect(JSON.parse(lines[0])).toMatchObject({ requestId: 'req-7', extra: 1, message: 'hi' });
  });

  it('is not coloured', async () => {
    const { logger, lines } = await load({ LOG_FORMAT: 'json' });

    logger.error('bad');

    expect(lines[0]).not.toContain('\u001b[');
    expect(JSON.parse(lines[0]).level).toBe('error');
  });

  it('logs an error with its name, message and stack', async () => {
    const { logError, lines } = await load({ LOG_FORMAT: 'json' });

    logError(new TypeError('boom'), { operation: 'analyzer', analyzer: 'ruff' });

    const line = JSON.parse(lines[0]);
    expect(line).toMatchObject({ level: 'error', message: 'boom', operation: 'analyzer', analyzer: 'ruff' });
    expect(line.error).toMatchObject({ name: 'TypeError', message: 'boom' });
    expect(line.error.stack).toContain('TypeError: boom');
  });

  it('logs a performance line with the duration as a number', async () => {
    const { logPerformance, lines } = await load({ LOG_FORMAT: 'json' });

    logPerformance('review', 1500, { requestId: 'r1' });

    expect(JSON.parse(lines[0])).toMatchObject({ level: 'warn', operation: 'review', durationMs: 1500, duration: '1500ms', requestId: 'r1' });
  });

  it('logs the start-up as one line with fields instead of a banner', async () => {
    const { logStartup, lines } = await load({ LOG_FORMAT: 'json' });

    logStartup(4000, 'production');

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      message: 'Application starting',
      environment: 'production',
      port: 4000,
      logDirectory: null,
      nodeVersion: process.version
    });
  });

  it('logs the shutdown as one line with the reason', async () => {
    const { logShutdown, lines } = await load({ LOG_FORMAT: 'json' });

    logShutdown('SIGTERM');

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ level: 'warn', message: 'Application shutting down', reason: 'SIGTERM' });
  });
});

describe('LOG_FORMAT=pretty', () => {
  it('prints a readable line, not JSON', async () => {
    const { logger, lines } = await load({ LOG_FORMAT: 'pretty' });

    logger.info('hello');

    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[.*info.*\]: hello$/);
  });

  it('shows the fields of a log call without a "metadata" wrapper or a second timestamp', async () => {
    const { logger, lines } = await load({ LOG_FORMAT: 'pretty' });

    logger.info('Review requested', { filename: 'a.js' });

    expect(lines[0]).toContain('"filename": "a.js"');
    expect(lines[0]).not.toContain('metadata');
    expect(lines[0].match(/\d{4}-\d{2}-\d{2}T/g)).toHaveLength(1);
  });

  it('still prints the start-up banner', async () => {
    const { logStartup, lines } = await load({ LOG_FORMAT: 'pretty' });

    logStartup(4000, 'development');

    expect(lines.length).toBeGreaterThan(5);
    expect(lines.join('\n')).toContain('Application Starting');
  });
});

describe('choosing the format', () => {
  it.each([
    ['production', 'json'],
    ['development', 'pretty'],
    ['test', 'pretty']
  ])('defaults to the right one when NODE_ENV=%s', async (nodeEnv, expected) => {
    const { logger, lines } = await load({ NODE_ENV: nodeEnv });

    logger.info('x');

    expect(lines[0].startsWith('{')).toBe(expected === 'json');
  });

  it('lets LOG_FORMAT override the default', async () => {
    const { logger, lines } = await load({ NODE_ENV: 'production', LOG_FORMAT: 'pretty' });

    logger.info('x');

    expect(lines[0].startsWith('{')).toBe(false);
  });

  it('ignores a value it does not know and uses the default', async () => {
    const { logger, lines } = await load({ NODE_ENV: 'production', LOG_FORMAT: 'xml' });

    logger.info('x');

    expect(lines[0].startsWith('{')).toBe(true);
  });

  it('accepts capital letters and spaces', async () => {
    const { logger, lines } = await load({ NODE_ENV: 'production', LOG_FORMAT: ' Pretty ' });

    logger.info('x');

    expect(lines[0].startsWith('{')).toBe(false);
  });
});

describe('the log files', () => {
  it('are JSON with the same flat fields, whatever the console prints', async () => {
    const { mkdtempSync, readFileSync, existsSync, rmSync } = await import('fs');
    const { tmpdir } = await import('os');
    const path = await import('path');
    const dir = mkdtempSync(path.join(tmpdir(), 'logger-format-'));
    const file = path.join(dir, 'combined.log');

    vi.resetModules();
    vi.stubEnv('LOG_FORMAT', 'pretty');
    vi.stubEnv('LOG_TO_FILE', 'true');
    vi.stubEnv('LOG_TO_CONSOLE', 'false');
    vi.stubEnv('LOG_LEVEL', 'info'); // the test setup lowers it to "error"
    vi.stubEnv('LOG_DIRECTORY', dir);
    const { createChildLogger } = await import('./logger.util');

    createChildLogger({ requestId: 'f-1' }).info('to the file', { filename: 'a.js' });

    // The file is written in the background, so wait for the line to show up.
    for (let i = 0; i < 100 && !(existsSync(file) && readFileSync(file, 'utf8').includes('to the file')); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const line = JSON.parse(readFileSync(file, 'utf8').trim().split('\n')[0]);
    rmSync(dir, { recursive: true, force: true });

    expect(line).toMatchObject({ level: 'info', message: 'to the file', requestId: 'f-1', filename: 'a.js' });
    expect(line.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(line).not.toHaveProperty('metadata');
  });
});
