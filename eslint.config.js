// =============================================================================
// ESLint flat config. The point of having this at all is `no-undef`: esbuild
// happily bundles a reference to a symbol that no longer exists (as we learned
// extracting shared helpers), and only crashes at runtime. Linting catches that
// class of bug at edit time. Unused-vars is a warning so it doesn't drown the
// existing code; no-undef is an error.
// =============================================================================

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";

export default [
  { ignores: ["out/**", "dist/**", "node_modules/**", "resources/**", "build/**"] },

  js.configs.recommended,

  // Vite `define` compile-time constants (see electron.vite.config.js) — real at
  // build time, invisible to the linter, so declare them everywhere.
  {
    languageOptions: {
      globals: { __BUNGIE_API_KEY__: "readonly", __BUNGIE_CLIENT_ID__: "readonly" },
    },
  },

  // Node side: Electron main + preload, the Railway server, CLI scripts, and the
  // build config itself.
  {
    files: [
      "src/main/**/*.js",
      "src/preload/**/*.js",
      "server/**/*.{js,mjs}",
      "scripts/**/*.mjs",
      "test/**/*.js",
      "*.config.js",
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },

  // Renderer: React + browser globals + JSX. Automatic JSX runtime, so `React`
  // is intentionally never referenced.
  {
    files: ["src/renderer/**/*.{js,jsx}"],
    plugins: { "react-hooks": reactHooks, react },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Mark JSX-referenced identifiers as used so no-unused-vars doesn't flag
      // every component as dead. (Automatic runtime → no jsx-uses-react needed.)
      "react/jsx-uses-vars": "error",
      // Reset-on-change (`if (…) { setX([]); return; }`) is a deliberate pattern
      // here; keep it visible but non-blocking rather than an error.
      "react-hooks/set-state-in-effect": "warn",
    },
  },

  // Project-wide tweaks.
  {
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
