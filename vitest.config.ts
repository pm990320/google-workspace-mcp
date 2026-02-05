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
      exclude: [
        'dist/cli.js',
        'dist/server.js',
        'dist/tools/**/*.js', // Tools require integration tests, not unit tests
        'dist/accounts.js', // Requires OAuth mocking
        'dist/serverWrapper.js', // Infrastructure code
        'dist/securityHelpers.js', // Security infrastructure
      ],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        statements: 40,
        branches: 35,
        functions: 45,
        lines: 40,
      },
    },
  },
});
