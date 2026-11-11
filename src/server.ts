import { logStartup, logShutdown } from "./utils/logger.util";
import { appConfig } from "./config/app.config";
import { createShutdownHandler } from "./shutdown";

function fail(reason: unknown): never {
    console.error('Failed to start server:', reason instanceof Error ? reason.message : reason);
    process.exit(1);
}

async function startServer(): Promise<void> {
    // The app is loaded here, not at the top of the file, so that a setting it refuses (for
    // example CORS_ORIGIN="*" in production) is reported and stops the process with a failure
    // code. The logger catches uncaught exceptions and would let the process end with 0.
    const { default: app } = await import('./app');

    const server = app.listen(appConfig.port, () => {
        logStartup(appConfig.port, appConfig.nodeEnv);
    });

    server.on('error', fail);

    // On SIGINT or SIGTERM, stop taking new requests and let running reviews finish.
    const shutdown = createShutdownHandler({
        server,
        timeoutMs: appConfig.shutdownTimeoutMs,
        exit: (code) => process.exit(code),
        log: logShutdown
    });

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

startServer().catch(fail);