import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

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

export const appConfig = {
  // Server Configuration
  nodeEnv: getEnvString('NODE_ENV', 'production'),
  port: getEnvNumber('PORT', 4000),
  host: getEnvString('HOST', 'localhost'),

  // Logging Configuration
  logLevel: getEnvString('LOG_LEVEL', 'info'),
  logToConsole: getEnvBoolean('LOG_TO_CONSOLE', true),
  logToFile: getEnvBoolean('LOG_TO_FILE', true),
  logDirectory: getEnvString('LOG_DIRECTORY', './logs'),

  // File Configuration
  maxFileSizeMB: getEnvNumber('MAX_FILE_SIZE_MB', 1),
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

  // Rate Limiting
  rateLimitWindowMinutes: getEnvNumber('RATE_LIMIT_WINDOW_MINUTES', 15),
  rateLimitMaxRequests: getEnvNumber('RATE_LIMIT_MAX_REQUESTS', 100)
};

// Export default
export default appConfig;