import express from "express";  
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
// import router from './routes/index';

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
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use(
    (
        err: Error,
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ) => {
        console.error(err.stack);
        res.status(500).json({
            error: "Internal Server Error",
            message:
                process.env.NODE_ENV === "development" ? err.message : undefined,
        });
    }
);

// Routes
// app.use('/api', router);


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;