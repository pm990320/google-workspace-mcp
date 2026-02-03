const ignores = require('./eslint.ignores.cjs');
const security = require('eslint-plugin-security');
const tseslint = require('typescript-eslint');

module.exports = [
  {ignores},
  ...require('gts'),
  {
    plugins: {
      security,
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      ...security.configs.recommended.rules,
      // Allow underscore-prefixed unused variables (common TypeScript convention)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
];
