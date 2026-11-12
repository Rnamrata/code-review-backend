import express from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';

import routes from './routes';
import { errorHandler } from './middlewares/errorHandler.middleware';
import { createCors } from './middlewares/cors.middleware';
import { attachRequestId } from './middlewares/requestId.middleware';
import { recordMetrics } from './middlewares/metrics.middleware';
import { accessLog } from './middlewares/accessLog.middleware';
import { metrics } from './services/metrics.service';
import { checkReadiness } from './services/readiness.service'
import { appConfig } from './config/app.config';

// Load environment variables
dotenv.config({ quiet: true });

const app = express();

// Middleware
app.use(helmet());
app.use(createCors(appConfig.corsOrigin, appConfig.nodeEnv));

// Metrics count every answer. The access log is noise in test output.
app.use(recordMetrics);
if (appConfig.nodeEnv !== 'test') {
    app.use(accessLog);
}

// Every answer from /review carries a request id, including one for a body that is not valid JSON
// or is too large, which the body parser rejects before any route runs.
app.use('/review', attachRequestId);

app.use(express.json({ limit: appConfig.jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: appConfig.jsonBodyLimit }));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// Readiness check: is Ruff installed and, when the LLM is on, is Ollama up with the model?
// Kept apart from /health, which stays cheap and only says the process is running.
app.get('/ready', async (req, res) => {
    const readiness = await checkReadiness();
    res.status(readiness.ready ? 200 : 503).json(readiness);
});

// Metrics for a scraper such as Prometheus: request counts, review and analyzer timings, failures
// and findings. Open to anyone who can reach the service, like /health, so keep the service
// itself on an internal network. METRICS_ENABLED=false removes the route (it then answers 404).
if (appConfig.metricsEnabled) {
    app.get('/metrics', async (req, res) => {
        res.set('Content-Type', metrics.contentType).send(await metrics.render());
    });
}

// Routes
app.use(routes);

// 404 handler (must come after routes)
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.path}`
    });
});

// Error handling middleware
app.use(errorHandler);

export default app;