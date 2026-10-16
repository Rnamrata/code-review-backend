import app from './app';
import { logStartup, logShutdown } from "./utils/logger.util";
import { appConfig } from "./config/app.config";

// Initialize server
const PORT = appConfig.port;

async function startServer(): Promise<void> {
    try {
        app.listen(PORT, () => {
            logStartup(PORT, appConfig.nodeEnv);
        });
    } catch (error) {
        console.error('Failed to start server', error);
        process.exit(1);
    }
}

process.on('SIGINT', () => {
    logShutdown('SIGINT signal received');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logShutdown('SIGTERM signal received');
    process.exit(0);
});

startServer();
