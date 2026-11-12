import { afterEach, describe, expect, it, vi } from 'vitest';

// The config reads the environment once, when the module loads, so each test sets what it
// needs and loads a fresh copy. An empty value makes the setting fall back to its default.
const loadConfig = async (env: Record<string, string> = {}) => {
  vi.resetModules();
  for (const key of ['MAX_FILE_SIZE_MB', 'CORS_ORIGIN', 'SHUTDOWN_TIMEOUT_MS', 'READINESS_TIMEOUT_MS']) {
    vi.stubEnv(key, '');
  }
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return (await import('./app.config')).appConfig;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('request body limit', () => {
  it('is twice the file size limit by default', async () => {
    const config = await loadConfig();

    expect(config.maxFileSizeMB).toBe(1);
    expect(config.jsonBodyLimit).toBe('2mb');
  });

  it('follows MAX_FILE_SIZE_MB', async () => {
    expect((await loadConfig({ MAX_FILE_SIZE_MB: '3' })).jsonBodyLimit).toBe('6mb');
  });

  it('never goes below one megabyte', async () => {
    expect((await loadConfig({ MAX_FILE_SIZE_MB: '0' })).jsonBodyLimit).toBe('1mb');
  });
});

describe('CORS setting', () => {
  it('allows no browser origin by default', async () => {
    expect((await loadConfig()).corsOrigin).toBe('');
  });

  it('reads CORS_ORIGIN', async () => {
    expect((await loadConfig({ CORS_ORIGIN: 'http://chat.test' })).corsOrigin).toBe('http://chat.test');
  });
});

describe('shutdown and readiness settings', () => {
  it('lets running reviews finish for 50 seconds by default, longer than one review can take', async () => {
    const config = await loadConfig();

    expect(config.shutdownTimeoutMs).toBe(50000);
    expect(config.shutdownTimeoutMs).toBeGreaterThan(config.llmTimeoutMs);
  });

  it('reads SHUTDOWN_TIMEOUT_MS', async () => {
    expect((await loadConfig({ SHUTDOWN_TIMEOUT_MS: '1000' })).shutdownTimeoutMs).toBe(1000);
  });

  it('waits 3 seconds for the readiness checks by default', async () => {
    expect((await loadConfig()).readinessTimeoutMs).toBe(3000);
  });
});

describe('removed settings', () => {
  it('no longer has the unused host setting', async () => {
    expect('host' in (await loadConfig())).toBe(false);
  });
});

describe('logging and metrics settings', () => {
  const keys = ['LOG_FORMAT', 'METRICS_ENABLED', 'NODE_ENV'];
  const load = async (env: Record<string, string> = {}) => {
    vi.resetModules();
    for (const key of keys) vi.stubEnv(key, '');
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    return (await import('./app.config')).appConfig;
  };

  it('prints JSON logs in production and readable ones elsewhere', async () => {
    expect((await load({ NODE_ENV: 'production' })).logFormat).toBe('json');
    expect((await load({ NODE_ENV: 'development' })).logFormat).toBe('pretty');
    expect((await load({ NODE_ENV: 'test' })).logFormat).toBe('pretty');
  });

  it('treats an unset NODE_ENV as production, like the rest of the service', async () => {
    expect((await load()).logFormat).toBe('json');
  });

  it('reads LOG_FORMAT, ignoring case and spaces', async () => {
    expect((await load({ NODE_ENV: 'development', LOG_FORMAT: 'JSON' })).logFormat).toBe('json');
    expect((await load({ NODE_ENV: 'production', LOG_FORMAT: ' pretty ' })).logFormat).toBe('pretty');
  });

  it('falls back to the default for a value it does not know', async () => {
    expect((await load({ NODE_ENV: 'development', LOG_FORMAT: 'yaml' })).logFormat).toBe('pretty');
  });

  it('serves metrics unless METRICS_ENABLED=false', async () => {
    expect((await load()).metricsEnabled).toBe(true);
    expect((await load({ METRICS_ENABLED: 'true' })).metricsEnabled).toBe(true);
    expect((await load({ METRICS_ENABLED: 'false' })).metricsEnabled).toBe(false);
  });
});
