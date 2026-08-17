import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Determinism rule 6 (spec/00-overview.md): sim code must not import DOM, Canvas, timers,
// Math.random or Date. Rule 3/4 (integer-only, no floating point in sim state) is not
// statically lintable — it is pinned by the M1+ unit tests and the state hash instead.
const SIM = 'spec/00-overview.md §Determinism';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'art_assets/**',
      'asset_reference/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,js}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  {
    files: ['src/render/**/*.ts', 'src/main.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },

  // ---- sim purity ----------------------------------------------------------
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: `No randomness in the sim (${SIM} rule 2).`,
        },
        {
          object: 'Date',
          property: 'now',
          message: `No wall-clock time in the sim (${SIM} rule 6).`,
        },
        {
          object: 'performance',
          property: 'now',
          message: `No wall-clock time in the sim (${SIM} rule 6).`,
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: `No DOM in the sim (${SIM} rule 6).` },
        { name: 'document', message: `No DOM in the sim (${SIM} rule 6).` },
        { name: 'navigator', message: `No DOM in the sim (${SIM} rule 6).` },
        { name: 'localStorage', message: `No DOM in the sim (${SIM} rule 6).` },
        { name: 'fetch', message: `No I/O in the sim (${SIM} rule 6).` },
        {
          name: 'setTimeout',
          message: `No timers in the sim; the sim is tick-driven (${SIM} rule 1).`,
        },
        {
          name: 'setInterval',
          message: `No timers in the sim; the sim is tick-driven (${SIM} rule 1).`,
        },
        {
          name: 'requestAnimationFrame',
          message: `No frame callbacks in the sim; the sim is tick-driven (${SIM} rule 1).`,
        },
        { name: 'performance', message: `No wall-clock time in the sim (${SIM} rule 6).` },
        { name: 'Date', message: `No wall-clock time in the sim (${SIM} rule 6).` },
      ],
      // Only sibling modules inside src/sim may be imported: no packages, no node
      // builtins, no reaching into src/render or src/assets. Precise AST selectors, so
      // that "./room.js" is allowed and "node:fs" is not.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ':matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^[^.]/]',
          message: `src/sim must be self-contained and headless: no packages or node builtins (${SIM} rule 6).`,
        },
        {
          selector:
            ':matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^[.][.]/]',
          message: `src/sim may only import its own siblings — no DOM, canvas, assets or renderer (${SIM} rule 6).`,
        },
        {
          selector: 'ImportExpression[source.value=/^[^.]/]',
          message: `src/sim must be self-contained and headless (${SIM} rule 6).`,
        },
      ],
    },
  },

  prettier,
);
