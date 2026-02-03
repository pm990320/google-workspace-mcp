import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import security from 'eslint-plugin-security';

export default tseslint.config(
  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript strict type-checked rules (requires parserOptions.project)
  ...tseslint.configs.strictTypeChecked,

  // TypeScript stylistic rules for consistency
  ...tseslint.configs.stylisticTypeChecked,

  // Security plugin for detecting common vulnerabilities
  security.configs.recommended,

  // Prettier compatibility (must be last to override formatting rules)
  eslintConfigPrettier,

  // Global ignores
  {
    ignores: ['dist/**', 'node_modules/**', '*.cjs', '*.js'],
  },

  // TypeScript source files configuration
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // === Type Safety ===
      // Disallow any types - use proper typing
      '@typescript-eslint/no-explicit-any': 'error',

      // These are included in strictTypeChecked but explicitly listed for clarity:
      // - no-unsafe-assignment: Disallow assigning any to variables
      // - no-unsafe-member-access: Disallow member access on any
      // - no-unsafe-call: Disallow calling any
      // - no-unsafe-argument: Disallow passing any as arguments
      // - no-unsafe-return: Disallow returning any

      // === Promise Safety ===
      // Require Promise rejections to be handled
      '@typescript-eslint/no-floating-promises': 'error',
      // Prevent misuse of Promises (e.g., in conditionals without await)
      '@typescript-eslint/no-misused-promises': 'error',

      // === Code Quality ===
      // Allow unused vars starting with underscore (for intentionally unused params)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Prefer const for variables that are never reassigned
      'prefer-const': 'error',

      // Enforce consistent type imports (import type { X } for types)
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
          disallowTypeAnnotations: false,
        },
      ],

      // === Relaxed Rules ===
      // Allow console (used for CLI output and debugging)
      'no-console': 'off',

      // Allow non-null assertions where we know better than TS (use sparingly)
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // Allow empty functions (common for no-op callbacks)
      '@typescript-eslint/no-empty-function': 'off',

      // Relax restriction on template literal types (useful for API params)
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
          allowBoolean: true,
          allowNullish: true,
        },
      ],

      // Prefer nullish coalescing, but allow || for string/number/boolean
      // (where falsy values like '' or 0 should also trigger the fallback)
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        {
          ignorePrimitives: {
            string: true,
            number: true,
            boolean: true,
          },
        },
      ],

      // === Security (from eslint-plugin-security) ===
      // These are included via security.configs.recommended:
      // - security/detect-object-injection: Warn on dynamic property access
      // - security/detect-non-literal-regexp: Warn on dynamic regex
      // - security/detect-unsafe-regex: Warn on ReDoS-vulnerable regex
      // - security/detect-buffer-noassert: Warn on buffer without assertion
      // - security/detect-eval-with-expression: Error on eval()
      // - security/detect-no-csrf-before-method-override: CSRF protection
      // - security/detect-possible-timing-attacks: Timing attack detection
    },
  },

  // Test files - more relaxed rules
  {
    files: ['tests/**/*.js', 'tests/**/*.ts'],
    rules: {
      // Allow require in test files
      '@typescript-eslint/no-require-imports': 'off',
      // Allow any in tests for mocking
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  }
);
