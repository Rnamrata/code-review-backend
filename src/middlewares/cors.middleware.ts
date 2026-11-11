import cors from 'cors';

// Browsers are the only callers CORS matters for. This service is called by another server
// (the chatbot's backend), so by default no browser origin is allowed at all.
export function resolveCorsOrigins(value: string, nodeEnv: string): string[] | '*' | false {
    const origins = value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    if (origins.length === 0) return false;

    if (origins.includes('*')) {
        if (nodeEnv === 'production') {
            throw new Error('CORS_ORIGIN must not be "*" in production: list the allowed origins instead');
        }
        return '*';
    }

    return origins;
}

export function createCors(value: string, nodeEnv: string) {
    return cors({
        origin: resolveCorsOrigins(value, nodeEnv),
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Accept', 'Content-Type', 'X-Request-Id'],
        exposedHeaders: ['X-Request-Id'],
        credentials: false // the service has no cookies or login
    });
}