import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/regressions/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    environment: 'node',
    testTimeout: 30000,
    // Sequential — share login across test files (avoid login rate-limit 429)
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
