import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ quiet: true });

const getEnvString = (key: string, defaultValue: string): string => {
  return process.env[key] || defaultValue;
};

const getEnvNumber = (key: string, defaultValue: number): number => {
  const value = process.env[key];
  return value ? parseInt(value, 10) : defaultValue;
};

const getEnvBoolean = (key: string, defaultValue: boolean): boolean => {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
};

const getEnvFloat = (key: string, defaultValue: number): number => {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
};

export const appConfig = {
  // Server Configuration
  nodeEnv: getEnvString('NODE_ENV', 'production'),
  port: getEnvNumber('PORT', 4000),

  // Logging Configuration
  logLevel: getEnvString('LOG_LEVEL', 'info'),
  logToConsole: getEnvBoolean('LOG_TO_CONSOLE', true),
  logToFile: getEnvBoolean('LOG_TO_FILE', true),
  logDirectory: getEnvString('LOG_DIRECTORY', './logs'),

  // File Configuration
  maxFileSizeMB: getEnvNumber('MAX_FILE_SIZE_MB', 1),
   // The request body carries the code inside JSON, which adds escaping, so it may be larger than the code.
  jsonBodyLimit: `${Math.max(1, getEnvNumber('MAX_FILE_SIZE_MB', 1) * 2)}mb`,
  allowedExtensions: getEnvString('ALLOWED_EXTENSIONS', '.py,.js,.java,.ts,.jsx,.tsx')
    .split(',')
    .map((ext) => ext.trim()),
  
  // Ruff
  ruffBin: getEnvString('RUFF_BIN', 'ruff'),
  ruffTimeoutMs: getEnvNumber('RUFF_TIMEOUT_MS', 15000),

  // Complexity Thresholds
  cyclomaticComplexityThreshold: getEnvNumber('CYCLOMATIC_COMPLEXITY_THRESHOLD', 5),
  cognitiveComplexityThreshold: getEnvNumber('COGNITIVE_COMPLEXITY_THRESHOLD', 7),
  maxNestingDepth: getEnvNumber('MAX_NESTING_DEPTH', 2),
  llmEnabled: getEnvBoolean('LLM_ENABLED', false),
  ollamaBaseUrl: getEnvString('OLLAMA_BASE_URL', 'http://localhost:11434').replace(/\/+$/, ''),
  llmModel: getEnvString('LLM_MODEL', 'qwen2.5-coder:7b'),
  llmTemperature: getEnvFloat('LLM_TEMPERATURE', 0),
  llmTimeoutMs: getEnvNumber('LLM_TIMEOUT_MS', 40000),
  llmNumCtx: getEnvNumber('LLM_NUM_CTX', 8192),
  llmKeepAlive: getEnvString('LLM_KEEP_ALIVE', '30m'),
  llmMaxCodeChars: getEnvNumber('LLM_MAX_CODE_CHARS', 12000),
  llmMaxFindings: getEnvNumber('LLM_MAX_FINDINGS', 20),
  llmSeed: getEnvNumber('LLM_SEED', 42),

   // Browser access (CORS). Empty means no browser origin is allowed; "*" is refused in production.
  corsOrigin: getEnvString('CORS_ORIGIN', ''),

  // Shutdown and readiness
  shutdownTimeoutMs: getEnvNumber('SHUTDOWN_TIMEOUT_MS', 50000),
  readinessTimeoutMs: getEnvNumber('READINESS_TIMEOUT_MS', 3000),


  // Rate Limiting
  rateLimitWindowMinutes: getEnvNumber('RATE_LIMIT_WINDOW_MINUTES', 15),
  rateLimitMaxRequests: getEnvNumber('RATE_LIMIT_MAX_REQUESTS', 100)
};

// Export default
export default appConfig;