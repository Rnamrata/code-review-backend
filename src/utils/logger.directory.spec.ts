import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The logger reads its settings when it is loaded, so each test sets them and loads a fresh copy.
let parent: string;
let logDirectory: string;

const loadLogger = async (logToFile: 'true' | 'false') => {
  vi.resetModules();
  vi.stubEnv('LOG_DIRECTORY', logDirectory);
  vi.stubEnv('LOG_TO_FILE', logToFile);
  return import('./logger.util');
};

beforeEach(() => {
  parent = mkdtempSync(path.join(tmpdir(), 'logger-spec-'));
  logDirectory = path.join(parent, 'logs');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  rmSync(parent, { recursive: true, force: true });
});

describe('the log folder', () => {
  it('is not created when log files are switched off', async () => {
    await loadLogger('false');

    expect(existsSync(logDirectory)).toBe(false);
  });

  it('is created when log files are switched on', async () => {
    const { logger } = await loadLogger('true');
    logger.close();

    expect(existsSync(logDirectory)).toBe(true);
  });

  it('is created with its parents when they are missing', async () => {
    logDirectory = path.join(parent, 'deep', 'er', 'logs');

    const { logger } = await loadLogger('true');
    logger.close();

    expect(existsSync(logDirectory)).toBe(true);
  });

  it('can be a place that does not exist and cannot be created, as long as no files are written', async () => {
    logDirectory = '/proc/not-a-place-you-can-write/logs';

    await expect(loadLogger('false')).resolves.toBeDefined();
  });
});

describe('the start-up banner', () => {
  it('names the log folder when files are written', async () => {
    const { logger, logStartup } = await loadLogger('true');
    const info = vi.spyOn(logger, 'info').mockImplementation((() => logger) as never);

    logStartup(4000, 'test');

    expect(info.mock.calls.map((call) => String(call[0]))).toContain(`Log Directory: ${path.resolve(logDirectory)}`);
    logger.close();
  });

  it('says log files are off when they are not written', async () => {
    const { logger, logStartup } = await loadLogger('false');
    const info = vi.spyOn(logger, 'info').mockImplementation((() => logger) as never);

    logStartup(4000, 'test');

    const lines = info.mock.calls.map((call) => String(call[0]));
    expect(lines).toContain('Log files: off');
    expect(lines.some((line) => line.startsWith('Log Directory'))).toBe(false);
  });
});

describe('the helpers that are left', () => {
  it('no longer includes the ones nothing used', async () => {
    const helpers = await loadLogger('false');

    for (const removed of ['logRequest', 'logAnalysis', 'logRag']) {
      expect(helpers, `${removed} should be gone`).not.toHaveProperty(removed);
    }
  });

  it('still includes the ones the service uses', async () => {
    const helpers = await loadLogger('false');

    for (const kept of ['logger', 'logError', 'logSecurity', 'logPerformance', 'createChildLogger', 'logStartup', 'logShutdown']) {
      expect(helpers, `${kept} should be there`).toHaveProperty(kept);
    }
  });
});
