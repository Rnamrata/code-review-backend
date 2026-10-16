import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    testTimeout: 15000,           // the first ESLint instance takes about a second
    env: {
      NODE_ENV: 'test',           // not 'development': no stack traces in responses
      LOG_TO_FILE: 'false',       // tests must not write into ./logs
      LOG_LEVEL: 'error'          // keep test output readable
    }
  }
});