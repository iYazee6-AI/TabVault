// ESLint 9 flat config. Run it with `npm run lint`.
//
// Three layers, in order:
//   1. @eslint/js recommended  - the real-bug rules (unused vars, undefined
//      globals, unreachable code, duplicate keys).
//   2. eslint-plugin-security recommended - injection-sink heuristics. Every
//      one of these is a *warning*: they are noisy by design, so they report
//      but never fail the run.
//   3. The two house rules below, which are errors: nothing in a Manifest V3
//      extension should be assigning HTML strings into the DOM.
//
// The HTML-sink rules are split across the two mechanisms on purpose so that a
// single sink is reported exactly once:
//   - `no-restricted-properties` catches the `insertAdjacentHTML(...)` call.
//   - `no-restricted-syntax`     catches `x.innerHTML = ...` assignments.
// Where a sink is provably static (a template literal with no interpolated
// data) it carries an `// eslint-disable-next-line <rule> -- reviewed: ...`
// comment at the call site. Anything without one is a real finding.

"use strict";

const js = require("@eslint/js");
const globals = require("globals");
const security = require("eslint-plugin-security");

const HTML_SINK =
  "HTML strings assigned into the DOM are an injection sink. Set textContent, or build the nodes with document.createElement and append.";

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "e2e/.tmp/**",
      "tools/.tmp/**",
      "lib/*.min.js",
      "qrcode.min.js",
    ],
  },

  js.configs.recommended,
  security.configs.recommended,

  {
    // Extension runtime code: popup, options, content scripts, app pages.
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: {
        ...globals.browser,
        chrome: "readonly",
      },
    },
    rules: {
      "no-restricted-properties": [
        "error",
        { property: "insertAdjacentHTML", message: HTML_SINK },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.property.name='innerHTML']",
          message: HTML_SINK,
        },
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.property.value='innerHTML']",
          message: HTML_SINK,
        },
      ],
    },
  },

  {
    // The service worker runs in a worker global scope, not a window.
    files: ["background.js", "offscreen.js"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },

  {
    // lib/*.js are UMD modules: browser global in the extension, CommonJS in
    // the node --test suites, so they see both sets of globals.
    files: ["lib/**/*.js"],
    languageOptions: {
      globals: { ...globals.commonjs, globalThis: "readonly" },
    },
  },

  {
    // Tooling and tests run in node, never in the browser.
    files: [
      "eslint.config.js",
      "tools/**/*.js",
      "test/**/*.js",
      "e2e/**/*.js",
      "spike/**/*.js",
    ],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
];
