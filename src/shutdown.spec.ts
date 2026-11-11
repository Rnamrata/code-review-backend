import http from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClosableServer, createShutdownHandler } from './shutdown';

// A server whose close() only finishes when the test says so.
function fakeServer(extra: Partial<ClosableServer> = {}) {
  const state: { finish: (error?: Error) => void } = { finish: () => undefined };
  const server: ClosableServer = {
    close: vi.fn((callback?: (error?: Error) => void) => {
      state.finish = (error) => callback?.(error);
    }),
    ...extra
  };
  return { server, state };
}

describe('createShutdownHandler', () => {
  let exit: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    exit = vi.fn();
    log = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops accepting connections on the first signal', () => {
    const { server } = fakeServer();

    createShutdownHandler({ server, timeoutMs: 1000, exit, log })('SIGTERM');

    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it('does not exit while a request is still running', () => {
    const { server } = fakeServer();

    createShutdownHandler({ server, timeoutMs: 1000, exit, log })('SIGTERM');

    expect(exit).not.toHaveBeenCalled();
  });

  it('exits with 0 once the server has closed', () => {
    const { server, state } = fakeServer();
    createShutdownHandler({ server, timeoutMs: 1000, exit, log })('SIGTERM');

    state.finish();

    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits with 1 when closing fails', () => {
    const { server, state } = fakeServer();
    createShutdownHandler({ server, timeoutMs: 1000, exit, log })('SIGTERM');

    state.finish(new Error('boom'));

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('stops anyway once the timeout passes', () => {
    const { server } = fakeServer();
    createShutdownHandler({ server, timeoutMs: 5000, exit, log })('SIGTERM');

    vi.advanceTimersByTime(4999);
    expect(exit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('cancels the timeout when the server closes in time', () => {
    const { server, state } = fakeServer();
    createShutdownHandler({ server, timeoutMs: 5000, exit, log })('SIGTERM');

    state.finish();
    vi.advanceTimersByTime(10_000);

    expect(exit).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops at once on a second signal', () => {
    const { server } = fakeServer();
    const handle = createShutdownHandler({ server, timeoutMs: 5000, exit, log });
    handle('SIGINT');

    handle('SIGINT');

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('does not close the server twice on a second signal', () => {
    const { server } = fakeServer();
    const handle = createShutdownHandler({ server, timeoutMs: 5000, exit, log });

    handle('SIGINT');
    handle('SIGINT');

    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it('drops idle connections at once so they cannot hold the server open', () => {
    const closeIdleConnections = vi.fn();
    const { server } = fakeServer({ closeIdleConnections });

    createShutdownHandler({ server, timeoutMs: 1000, exit, log })('SIGTERM');

    expect(closeIdleConnections).toHaveBeenCalledTimes(1);
  });

  it('keeps dropping idle connections while it waits, for requests that finish later', () => {
    const closeIdleConnections = vi.fn();
    const { server } = fakeServer({ closeIdleConnections });
    createShutdownHandler({ server, timeoutMs: 10_000, exit, log })('SIGTERM');

    vi.advanceTimersByTime(1000);

    expect(closeIdleConnections.mock.calls.length).toBeGreaterThan(3);
  });

  it('stops dropping connections once the server has closed', () => {
    const closeIdleConnections = vi.fn();
    const { server, state } = fakeServer({ closeIdleConnections });
    createShutdownHandler({ server, timeoutMs: 10_000, exit, log })('SIGTERM');

    state.finish();
    const callsAtClose = closeIdleConnections.mock.calls.length;
    vi.advanceTimersByTime(5000);

    expect(closeIdleConnections.mock.calls.length).toBe(callsAtClose);
  });

  it('stops dropping connections after the timeout', () => {
    const closeIdleConnections = vi.fn();
    const { server } = fakeServer({ closeIdleConnections });
    createShutdownHandler({ server, timeoutMs: 500, exit, log })('SIGTERM');

    vi.advanceTimersByTime(500);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('works with a server that cannot drop idle connections', () => {
    const { server } = fakeServer();

    expect(() => createShutdownHandler({ server, timeoutMs: 1000, exit, log })('SIGTERM')).not.toThrow();
  });

  it('logs the signal that started the shutdown', () => {
    const { server } = fakeServer();

    createShutdownHandler({ server, timeoutMs: 1000, exit, log })('SIGINT');

    expect(log).toHaveBeenCalledWith(expect.stringContaining('SIGINT'));
  });

  it('logs when it has to stop running reviews', () => {
    const { server } = fakeServer();
    createShutdownHandler({ server, timeoutMs: 100, exit, log })('SIGTERM');

    vi.advanceTimersByTime(100);

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/stopping anyway/));
  });
});

describe('with a real server', () => {
  it('lets a request that is already running finish, then exits with 0', async () => {
    const server = http.createServer((req, res) => {
      setTimeout(() => res.end('finished'), 300);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };

    const exit = vi.fn();
    const handle = createShutdownHandler({ server, timeoutMs: 5000, exit, log: vi.fn() });

    const inFlight = fetch(`http://127.0.0.1:${port}/`).then((res) => res.text());
    await new Promise((resolve) => setTimeout(resolve, 50)); // the request has reached the server
    handle('SIGTERM');

    expect(await inFlight).toBe('finished');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });

  it('refuses new connections after the signal', async () => {
    const server = http.createServer((req, res) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };
    const exit = vi.fn();

    createShutdownHandler({ server, timeoutMs: 5000, exit, log: vi.fn() })('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });
});
