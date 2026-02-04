import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests in tests/ (excluding integration)
    include: ['tests/**/*.test.{js,ts}'],
    exclude: ['tests/integration/**'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      include: ['dist/**/*.js'],
      exclude: ['dist/cli.js'],
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
