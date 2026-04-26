// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from 'eslint-plugin-storybook'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import pluginReact from 'eslint-plugin-react'
import { defineConfig } from 'eslint/config'
import pluginReactHooks from 'eslint-plugin-react-hooks'
import pluginImport from 'eslint-plugin-import'
import pluginPromise from 'eslint-plugin-promise'
import pluginRegex from 'eslint-plugin-regex'
import pluginVitest from 'eslint-plugin-vitest'
import pluginTestingLibrary from 'eslint-plugin-testing-library'
import stylistic from '@stylistic/eslint-plugin'
import cspellPlugin from '@cspell/eslint-plugin'
import prettier from 'eslint-config-prettier'

export default defineConfig([
  {
    ignores: [
      'dist',
      'node_modules',
      '*.min.js',
      'coverage',
      '**/*.d.ts',
      'playwright-report',
      'vite-plugin-*.ts',
      'src-tauri/target',
      'src-tauri/bindings/',
      '.claude/**',
      'src/bindings/',
      'docs/**',
      // E2E lives in a separate TS sub-project (tests/e2e/tsconfig.json)
      // with its own globals (WDIO: $, browser, expect) and framework
      // (Mocha describe/it/before/after). The main lint config's
      // `projectService` + cspell + stylistic rules don't carry cleanly.
      // Follow-up: add a dedicated E2E lint config that wires
      // tests/e2e/tsconfig.json, WDIO globals, and domain terms
      // (tput, xterm, wdio, pty, …) rather than extending the main one.
      'tests/e2e/**',
    ],
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      react: pluginReact,
      'react-hooks': pluginReactHooks,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...pluginReact.configs.recommended.rules,
      ...pluginReactHooks.configs.recommended.rules,

      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',

      // Common rules
      'arrow-body-style': 'error',
      'object-shorthand': 'error',
      'no-restricted-globals': ['error', 'React'],
      'no-console': 'error',

      'no-restricted-properties': [
        'error',
        {
          object: 'React',
          property: '*',
        },
      ],

      // React rules
      'react/jsx-boolean-value': [
        'error',
        'never',
        { assumeUndefinedIsFalse: true },
      ],
      'react/jsx-curly-brace-presence': 'error',
      'react/function-component-definition': [
        'error',
        {
          namedComponents: 'arrow-function',
          unnamedComponents: 'arrow-function',
        },
      ],
      'react/self-closing-comp': [
        'error',
        {
          component: true,
          html: true,
        },
      ],
      'react/require-default-props': [
        'error',
        { functions: 'defaultArguments' },
      ],
    },
    languageOptions: {
      globals: globals.browser,
    },
  },
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // TypeScript rules
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-shadow': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      // Test rules
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['*.config.ts', '*.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    plugins: {
      promise: pluginPromise,
    },
    rules: {
      ...pluginPromise.configs.recommended.rules,
      'promise/prefer-await-to-then': 'error',
    },
  },

  {
    plugins: {
      '@stylistic': stylistic,
    },
    rules: {
      // Stylistic rules
      '@stylistic/padding-line-between-statements': [
        'error',
        {
          blankLine: 'always',
          prev: 'multiline-expression',
          next: 'multiline-expression',
        },
        { blankLine: 'always', prev: '*', next: 'interface' },
        { blankLine: 'always', prev: 'interface', next: '*' },
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'never', prev: 'import', next: 'import' },
        { blankLine: 'always', prev: '*', next: 'export' },
        { blankLine: 'always', prev: '*', next: 'multiline-const' },
        { blankLine: 'always', prev: '*', next: 'return' },
      ],
    },
  },

  {
    files: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.spec.ts',
      'src/**/*.spec.tsx',
    ],
    plugins: {
      vitest: pluginVitest,
    },
    rules: {
      ...pluginVitest.configs.recommended.rules,
      // Test rules
      'vitest/consistent-test-it': ['error', { fn: 'test' }],
      'vitest/consistent-test-filename': 'error',
    },
    languageOptions: {
      globals: pluginVitest.environments.env.globals,
    },
  },

  {
    files: ['**/*.test.tsx'],
    plugins: {
      'testing-library': pluginTestingLibrary,
    },
    rules: {
      ...pluginTestingLibrary.configs.react.rules,
    },
  },

  {
    plugins: {
      regex: pluginRegex,
    },
    rules: {
      'regex/invalid': [
        'error',
        [
          {
            regex: 'import .* from (\'|")(~/|./|../).*\\b(\\w+)/\\3\\b(\'|")',
            message: 'Please remove duplicate path from local import path',
            replacement: {
              function:
                'const last = text.lastIndexOf(captured[2]); return last === -1 ? text : text.slice(0, last - 1) + text.slice(last + captured[2].length)',
            },
          },
        ],
      ],
    },
  },

  {
    plugins: {
      import: pluginImport,
    },
    rules: {
      'import/no-duplicates': 'error',
      'import/first': 'error',
      'import/newline-after-import': 'error',
    },
  },

  {
    plugins: {
      '@cspell': cspellPlugin,
    },
    rules: {
      '@cspell/spellchecker': [
        'error',
        {
          configFile: './cspell.config.yaml',
        },
      ],
    },
  },

  ...storybook.configs['flat/recommended'],

  prettier,
  {
    rules: {
      curly: ['error', 'all'],
    },
  },
])
