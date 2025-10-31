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

const RAG_BASE_URL = process.env.RAG_BASE_URL || '';

export const appConfig = {
  // Server Configuration
  nodeEnv: getEnvString('NODE_ENV', 'development'),
  port: getEnvNumber('PORT', 3000),
  host: getEnvString('HOST', 'localhost'),

  // Logging Configuration
  logLevel: getEnvString('LOG_LEVEL', 'info'),
  logToConsole: getEnvBoolean('LOG_TO_CONSOLE', true),
  logToFile: getEnvBoolean('LOG_TO_FILE', true),
  logDirectory: getEnvString('LOG_DIRECTORY', './logs'),

  // File Upload Configuration
  maxFileSizeMB: getEnvNumber('MAX_FILE_SIZE_MB', 1),
  allowedExtensions: getEnvString('ALLOWED_EXTENSIONS', '.py,.js,.java,.ts,.jsx,.tsx')
    .split(',')
    .map((ext) => ext.trim()),
  uploadDirectory: getEnvString('UPLOAD_DIRECTORY', './uploads'),

  // Session Configuration
  sessionTimeoutHours: getEnvNumber('SESSION_TIMEOUT_HOURS', 24),
  sessionCleanupIntervalHours: getEnvNumber('SESSION_CLEANUP_INTERVAL_HOURS', 1),
  sessionDirectory: getEnvString('SESSION_DIRECTORY', './sessions'),

  // RAG Configuration
  ragBaseUrl: getEnvString('RAG_BASE_URL', RAG_BASE_URL),
  ragTimeout: getEnvNumber('RAG_TIMEOUT', 30000),
  ragRetryAttempts: getEnvNumber('RAG_RETRY_ATTEMPTS', 3),

  // Analysis Configuration
  enableStaticAnalysis: getEnvBoolean('ENABLE_STATIC_ANALYSIS', true),
  enableSecurityAnalysis: getEnvBoolean('ENABLE_SECURITY_ANALYSIS', true),
  enableComplexityAnalysis: getEnvBoolean('ENABLE_COMPLEXITY_ANALYSIS', true),
  enableStyleChecking: getEnvBoolean('ENABLE_STYLE_CHECKING', true),
  enableRagAnalysis: getEnvBoolean('ENABLE_RAG_ANALYSIS', true),

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