'use strict';

const { defineConfig } = require('eslint/config');
const globals = require('globals');

const inlineScriptProcessor = {
  meta: {
    name: 'portal-inline-script-processor',
    version: '1.0.0',
  },
  preprocess(source) {
    let combined = '';
    let currentLine = 1;
    const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    for (const match of source.matchAll(scriptPattern)) {
      const attributes = match[1];
      if (/\bsrc\s*=/i.test(attributes)) continue;
      const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attributes);
      if (type && !/^(?:text|application)\/javascript$|^module$/i.test(type[1])) continue;
      const startLine = source.slice(0, match.index).split('\n').length;
      combined += '\n'.repeat(Math.max(0, startLine - currentLine)) + match[2];
      currentLine = startLine + match[2].split('\n').length - 1;
    }
    for (const match of source.matchAll(/\son[a-z]+\s*=\s*"([^"]*)"/gi)) {
      const handler = match[1]
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&amp;/g, '&');
      combined += `\n(function (event) { ${handler} }).call(this, event);`;
    }
    const actions = new Set(
      Array.from(source.matchAll(/\bdata-act\s*=\s*["']([A-Za-z_$][\w$]*)["']/gi), match => match[1])
    );
    for (const action of actions) {
      const registeredProperty = new RegExp(`\\b${action}\\s*:`).test(source);
      const queriedDirectly = source.includes(`[data-act="${action}"]`) || source.includes(`[data-act='${action}']`);
      if (!registeredProperty && !queriedDirectly) combined += `\nvoid ${action};`;
    }
    return combined.trim() ? [combined] : [];
  },
  postprocess(messageLists) {
    return messageLists.flat();
  },
  supportsAutofix: false,
};

const correctnessRules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', {
    argsIgnorePattern: '^_',
    caughtErrors: 'none',
  }],
  'no-implicit-globals': 'error',
  'no-shadow': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-fallthrough': 'error',
  'require-atomic-updates': 'error',
};

module.exports = defineConfig([
  {
    ignores: [
      'node_modules/**',
      'static/pptxgen.bundle.js',
      'static/worldmap.js',
    ],
  },
  {
    files: ['*.js', 'scripts/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: correctnessRules,
  },
  {
    files: ['static/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
        escapeHtml: 'readonly',
        releaseFocus: 'readonly',
        safeUrl: 'readonly',
        sanitizeHtml: 'readonly',
        toggleTheme: 'readonly',
        trapFocus: 'readonly',
      },
    },
    rules: correctnessRules,
  },
  {
    files: ['*.html'],
    processor: inlineScriptProcessor,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
        CportalAi: 'readonly',
        SubscriptionPicker: 'readonly',
        escapeHtml: 'readonly',
        releaseFocus: 'readonly',
        safeUrl: 'readonly',
        sanitizeHtml: 'readonly',
        toggleTheme: 'readonly',
        trapFocus: 'readonly',
      },
    },
    rules: {
      ...correctnessRules,
      // Inline page scripts intentionally share top-level declarations across
      // script blocks and event-handler attributes.
      'no-implicit-globals': 'off',
    },
  },
  {
    files: ['scripts/capture-screenshots.js'],
    languageOptions: {
      globals: globals.browser,
    },
  },
]);
