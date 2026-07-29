import { defineConfig } from 'vitest/config';

const integration = process.env.CH_CORE_INTEGRATION === '1';

export default defineConfig({
  test: {
    environment: 'node',
    include: integration
      ? ['test/**/*.integration.test.ts']
      : ['test/**/*.test.ts'],
    exclude: integration ? [] : ['test/**/*.integration.test.ts'],
    testTimeout: integration ? 60_000 : 5_000,
    hookTimeout: integration ? 60_000 : 10_000,
    fileParallelism: !integration,
  },
});
