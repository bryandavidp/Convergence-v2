// Config de ESLint (flat) para Convergence — sin package.json a propósito:
// el repo no tiene dependencias; el lint se ejecuta con `npx --yes eslint .`
// (en CI o en local). Objetivo: cazar referencias a identificadores inexistentes
// (no-undef) y errores obvios, no imponer estilo.
export default [
  {
    ignores: ['img/**'],
  },
  {
    files: ['game.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        // DOM / navegador usados por game.js
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        location: 'readonly', localStorage: 'readonly', matchMedia: 'readonly',
        performance: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        AudioContext: 'readonly', webkitAudioContext: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly', Image: 'readonly',
        Element: 'readonly', File: 'readonly',
        console: 'readonly', alert: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      eqeqeq: 'off',
    },
  },
  {
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        self: 'readonly', caches: 'readonly', fetch: 'readonly',
        URL: 'readonly', location: 'readonly', Promise: 'readonly', console: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'warn',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'writable', globalThis: 'readonly',
        console: 'readonly', setTimeout: 'readonly', process: 'readonly',
        __dirname: 'readonly', Promise: 'readonly', localStorage: 'readonly',
        // El dom-stub (tests/dom-stub.js) define estos globales del navegador.
        document: 'readonly', window: 'readonly', navigator: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'warn',
    },
  },
];
