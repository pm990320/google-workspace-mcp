import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.{js,ts}'],
    testTimeout: 120000, // 2 minutes for API calls
    hookTimeout: 60000, // 1 minute for setup/teardown
    reporters: ['verbose'],
    // Disable isolation so subprocess output streams through
    isolate: false,
    fileParallelism: false,
  },
});
