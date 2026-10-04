import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    environment: 'node',
    maxWorkers: 2,
  },
  resolve: {
    alias: { '@still/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname },
  },
});
