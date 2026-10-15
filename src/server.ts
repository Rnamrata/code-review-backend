import express from "express";  
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";

import routes from './routes';
import { errorHandler } from './middlewares/errorHandler.middleware';
import { logStartup, logShutdown } from "./utils/logger.util";
import { appConfig } from "./config/app.config";

// Load environment variables
dotenv.config();   

const app = express(); 

// Middleware
app.use(helmet());
app.use(
    cors({
        origin: process.env.CORS_ORIGIN || "*",
        credentials: true,
        methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
        allowedHeaders: [
            "Accept",
            "Origin",
            "Authorization",
            "Content-Type",
            "X-Csrf-Token",
            "X-Requested-With",
            "Range",
        ],
    })
);
app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({ 
        status: "healthy", 
        timestamp: new Date().toISOString() 
    });
});

// Routes
app.use(routes);

// 404 handler (must come after routes)
app.use((req, res) => {
    res.status(404).json({
        error: "Not Found",
        message: `Cannot ${req.method} ${req.path}`
    });
});

// Error handling middleware
app.use(errorHandler);

// Initialize server
const PORT = appConfig.port;

async function startServer() {
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

export default app;