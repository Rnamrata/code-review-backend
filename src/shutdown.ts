// What the shutdown handler needs from a server. http.Server satisfies it.
export interface ClosableServer {
    close(callback?: (error?: Error) => void): unknown;
    closeIdleConnections?(): void;
}

// A connection that finishes its request after close() was called becomes idle but stays open,
// so idle connections are dropped again and again until the server has closed.
const IDLE_SWEEP_MS = 250;

export interface ShutdownOptions {
    server: ClosableServer;
    // How long in-flight requests may keep running before the process is stopped anyway.
    timeoutMs: number;
    exit: (code: number) => void;
    log: (reason: string) => void;
}

// First signal: stop taking new connections, let requests already running finish, then exit.
// A second signal, or the timeout, stops the process at once.
export function createShutdownHandler({ server, timeoutMs, exit, log }: ShutdownOptions) {
    let shuttingDown = false;

    return (signal: string): void => {
        if (shuttingDown) {
            log(`${signal} signal received again, stopping now`);
            exit(1);
            return;
        }
        shuttingDown = true;
        log(`${signal} signal received, finishing running reviews first`);

        const timer = setTimeout(() => {
            clearInterval(sweeper);
            log(`Reviews still running after ${timeoutMs} ms, stopping anyway`);
            exit(1);
        }, timeoutMs);

        // Idle keep-alive connections would otherwise hold the server open until they time out.
        const sweeper = setInterval(() => server.closeIdleConnections?.(), IDLE_SWEEP_MS);

        server.close((error) => {
            clearTimeout(timer);
            clearInterval(sweeper);
            exit(error ? 1 : 0);
        });

        server.closeIdleConnections?.();
    };
}