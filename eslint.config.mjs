import globals from "globals";

/** 拡張機能の実行環境ごとにグローバルを分けて検査する。 */
export default [
  {
    ignores: ["dist/**", "node_modules/**", "test/**"],
  },
  {
    // popup / options / content script / lib（ブラウザ環境）
    files: ["popup/**/*.js", "options/**/*.js", "content/**/*.js", "lib/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: {
        ...globals.browser,
        chrome: "readonly",
        NoteToMarkdown: "readonly",
        NtmI18n: "readonly",
        NtmLikeCount: "readonly",
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      "no-unused-vars": ["error", { args: "after-used", argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-implicit-globals": "off",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      curly: "error",
      "no-throw-literal": "error",
      "no-return-await": "error",
      "require-await": "error",
    },
  },
  {
    // Service Worker
    files: ["background.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: {
        ...globals.serviceworker,
        chrome: "readonly",
        indexedDB: "readonly",
        NtmI18n: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { args: "after-used", argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      curly: "error",
      "no-throw-literal": "error",
    },
  },
  {
    // ビルド・テスト用の Node スクリプト
    files: ["scripts/**/*.mjs", "tests/**/*.mjs", "eslint.config.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": ["error", { args: "after-used", argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      curly: "error",
    },
  },
];
