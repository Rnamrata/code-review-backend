import { ChildProcess, spawn } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';

// Runs the real src/server.ts in a child process, the way `npm run dev` does.
const children: ChildProcess[] = [];

const runServer = (env: Record<string, string>) => {
  const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/server.ts'], {
    env: { ...process.env, PORT: '0', LOG_TO_FILE: 'false', LOG_LEVEL: 'info', LLM_ENABLED: 'false', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.push(child);

  let output = '';
  child.stdout?.on('data', (chunk) => (output += chunk));
  child.stderr?.on('data', (chunk) => (output += chunk));

  return {
    child,
    output: () => output,
    exited: new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
  };
};

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
});

describe('src/server.ts', () => {
  it('stops with a failure code and says why when CORS_ORIGIN is "*" in production', async () => {
    const server = runServer({ NODE_ENV: 'production', CORS_ORIGIN: '*' });

    expect(await server.exited).toBe(1);
    expect(server.output()).toMatch(/Failed to start server: CORS_ORIGIN must not be "\*" in production/);
  }, 30_000);

  it('starts, and stops cleanly with exit code 0 on SIGTERM', async () => {
    const server = runServer({ NODE_ENV: 'development' });
    await waitUntil(() => /Application Starting|Port:/.test(server.output()));

    server.child.kill('SIGTERM');

    expect(await server.exited).toBe(0);
    expect(server.output()).toMatch(/SIGTERM signal received/);
  }, 30_000);

  it('also stops cleanly on SIGINT', async () => {
    const server = runServer({ NODE_ENV: 'development' });
    await waitUntil(() => /Application Starting|Port:/.test(server.output()));

    server.child.kill('SIGINT');

    expect(await server.exited).toBe(0);
  }, 30_000);
});

// Polls until the condition holds (the server has printed its start-up lines).
async function waitUntil(condition: () => boolean, timeoutMs = 20_000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('server did not start in time');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
