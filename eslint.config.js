import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    ignores: ['dist/**', 'node_modules/**', '*.cjs'],
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      // Disallow any types - use proper typing
      '@typescript-eslint/no-explicit-any': 'error',
      // Allow unused vars starting with underscore (args and caught errors)
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      // Prefer const
      'prefer-const': 'error',
      // Allow console in source (used for debugging in helper modules)
      'no-console': 'off',
    },
  },
  {
    files: ['tests/**/*.js'],
    rules: {
      // Allow require in test files
      '@typescript-eslint/no-require-imports': 'off',
    },
  }
);
