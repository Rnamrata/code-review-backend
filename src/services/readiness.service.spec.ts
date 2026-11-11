import { execFile } from 'child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfig } from '../config/app.config';
import { checkReadiness } from './readiness.service';

vi.mock('child_process', () => ({ execFile: vi.fn() }));

const execFileMock = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;
const fetchMock = vi.fn();
const original = { ...appConfig };

// Makes the stand-in for `ruff --version` succeed with a version, or fail.
const ruffSays = (outcome: { version?: string; error?: Error }) =>
  execFileMock.mockImplementation((_bin: string, _args: string[], _options: unknown, callback: Function) => {
    callback(outcome.error ?? null, outcome.version ?? '', '');
  });

const ollamaHas = (...names: string[]) =>
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ models: names.map((name) => ({ name })) })));

beforeEach(() => {
  execFileMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(appConfig, original, {
    llmEnabled: false,
    ruffBin: 'ruff',
    ollamaBaseUrl: 'http://ollama.test:11434',
    llmModel: 'qwen2.5-coder:7b',
    readinessTimeoutMs: 3000
  });
  ruffSays({ version: 'ruff 0.17.0\n' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(appConfig, original);
});

describe('Ruff check', () => {
  it('passes with the version Ruff reports', async () => {
    const { checks } = await checkReadiness();

    expect(checks.ruff).toEqual({ ok: true, detail: 'ruff 0.17.0' });
  });

  it('asks the configured binary for its version', async () => {
    appConfig.ruffBin = '/opt/bin/ruff';

    await checkReadiness();

    expect(execFileMock.mock.calls[0][0]).toBe('/opt/bin/ruff');
    expect(execFileMock.mock.calls[0][1]).toEqual(['--version']);
  });

  it('gives the command a time limit', async () => {
    appConfig.readinessTimeoutMs = 1234;

    await checkReadiness();

    expect(execFileMock.mock.calls[0][2]).toMatchObject({ timeout: 1234 });
  });

  it('fails when Ruff cannot be run', async () => {
    ruffSays({ error: new Error('spawn ruff ENOENT') });

    const { checks } = await checkReadiness();

    expect(checks.ruff.ok).toBe(false);
  });

  it('does not leak the raw error text', async () => {
    ruffSays({ error: new Error('spawn /secret/path/ruff ENOENT') });

    const { checks } = await checkReadiness();

    expect(checks.ruff.detail).toBe('Ruff is not available');
  });
});

describe('Ollama check', () => {
  it('is skipped while the LLM analyzer is off', async () => {
    const { checks } = await checkReadiness();

    expect(checks.ollama.ok).toBe(true);
    expect(checks.ollama.detail).toMatch(/not used/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes when the configured model is installed', async () => {
    appConfig.llmEnabled = true;
    ollamaHas('llama3.2:latest', 'qwen2.5-coder:7b');

    const { checks } = await checkReadiness();

    expect(checks.ollama).toEqual({ ok: true, detail: 'model qwen2.5-coder:7b is installed' });
  });

  it('asks the model list of the configured server', async () => {
    appConfig.llmEnabled = true;
    ollamaHas('qwen2.5-coder:7b');

    await checkReadiness();

    expect(fetchMock.mock.calls[0][0]).toBe('http://ollama.test:11434/api/tags');
  });

  it('gives the request a time limit', async () => {
    appConfig.llmEnabled = true;
    ollamaHas('qwen2.5-coder:7b');

    await checkReadiness();

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts a model configured without a tag when Ollama lists it as latest', async () => {
    appConfig.llmEnabled = true;
    appConfig.llmModel = 'llama3.2';
    ollamaHas('llama3.2:latest');

    expect((await checkReadiness()).checks.ollama.ok).toBe(true);
  });

  it('fails and says how to install a model that is missing', async () => {
    appConfig.llmEnabled = true;
    ollamaHas('llama3.2:latest');

    const { checks } = await checkReadiness();

    expect(checks.ollama.ok).toBe(false);
    expect(checks.ollama.detail).toBe('model qwen2.5-coder:7b is not installed (run: ollama pull qwen2.5-coder:7b)');
  });

  it('does not take a different size of the same model for the configured one', async () => {
    appConfig.llmEnabled = true;
    ollamaHas('qwen2.5-coder:1.5b');

    expect((await checkReadiness()).checks.ollama.ok).toBe(false);
  });

  it('fails when Ollama lists no models', async () => {
    appConfig.llmEnabled = true;
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({})));

    expect((await checkReadiness()).checks.ollama.ok).toBe(false);
  });

  it('fails when Ollama answers with an error status', async () => {
    appConfig.llmEnabled = true;
    fetchMock.mockImplementation(async () => new Response('nope', { status: 500 }));

    const { checks } = await checkReadiness();

    expect(checks.ollama).toEqual({ ok: false, detail: 'Ollama answered with status 500' });
  });

  it('fails when Ollama cannot be reached', async () => {
    appConfig.llmEnabled = true;
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const { checks } = await checkReadiness();

    expect(checks.ollama).toEqual({ ok: false, detail: 'Ollama is unreachable' });
  });

  it('fails when Ollama answers with something that is not JSON', async () => {
    appConfig.llmEnabled = true;
    fetchMock.mockImplementation(async () => new Response('<html>proxy</html>'));

    expect((await checkReadiness()).checks.ollama.ok).toBe(false);
  });

  it('does not put the server address in its answer', async () => {
    appConfig.llmEnabled = true;
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const { checks } = await checkReadiness();

    expect(JSON.stringify(checks)).not.toContain('ollama.test');
  });
});

describe('overall readiness', () => {
  it('is ready when every check passes', async () => {
    appConfig.llmEnabled = true;
    ollamaHas('qwen2.5-coder:7b');

    expect((await checkReadiness()).ready).toBe(true);
  });

  it('is ready with the LLM off when only Ruff is needed', async () => {
    expect((await checkReadiness()).ready).toBe(true);
  });

  it('is not ready when Ruff is missing', async () => {
    ruffSays({ error: new Error('ENOENT') });

    expect((await checkReadiness()).ready).toBe(false);
  });

  it('is not ready when the LLM is on and Ollama is down', async () => {
    appConfig.llmEnabled = true;
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    expect((await checkReadiness()).ready).toBe(false);
  });

  it('runs both checks even when the first one fails', async () => {
    appConfig.llmEnabled = true;
    ruffSays({ error: new Error('ENOENT') });
    ollamaHas('qwen2.5-coder:7b');

    const { checks } = await checkReadiness();

    expect(checks.ruff.ok).toBe(false);
    expect(checks.ollama.ok).toBe(true);
  });
});
