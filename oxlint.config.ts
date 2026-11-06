import core, { ignorePatterns } from "adamantite/lint"
import { defineConfig } from "oxlint"

// Every folder in `src/lib` bans this pattern. A later override replaces the rule options of an
// earlier one, so each folder's rule repeats it.
const entryPoints = {
  group: ["#index.ts", "#stores/**"],
  message: "lib must not import an entry point.",
}

export default defineConfig({
  extends: [core],
  ignorePatterns: [...ignorePatterns],
  options: {
    respectEslintDisableDirectives: true,
    typeAware: true,
    typeCheck: true,
  },
  overrides: [
    // Dependencies inside `src/lib` point one way:
    //
    //   options, expiring-map <- algorithms <- store <- transitions <- stores/*
    //                                                <- limiter
    //
    // A folder imports its own files with `./` and other folders with `#lib/...`, so a rule can ban a
    // whole folder without banning a folder's own files. A limiter knows only the store contract,
    // never a concrete store or the arithmetic stores apply, and a store knows nothing of other stores
    // or of limiters. Each rule
    // covers its folder at every depth, and a folder without a rule of its own may import nothing else
    // in lib. A later override replaces an earlier one, so the last one lets tests cross these lines.
    {
      files: ["src/**/*.ts"],
      rules: {
        "import/no-relative-parent-imports": "error",
      },
    },
    {
      files: ["src/lib/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              entryPoints,
              {
                group: ["#lib/**"],
                message:
                  "This folder has no layer. Add its rule to oxlint.config.ts and its place to docs/architecture.md.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["src/lib/options/**/*.ts", "src/lib/expiring-map/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              entryPoints,
              {
                group: ["#lib/**"],
                message: "options and expiring-map import nothing else in lib.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["src/lib/algorithms/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              entryPoints,
              {
                group: ["#lib/**", "!#lib/options/**"],
                message: "algorithms import only options.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["src/lib/store/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              entryPoints,
              {
                group: ["#lib/**", "!#lib/algorithms/**"],
                message: "The store contract imports only algorithms.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["src/lib/transitions/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              entryPoints,
              {
                group: ["#lib/**", "!#lib/algorithms/**", "!#lib/store/**"],
                message: "transitions import only algorithms and the store contract.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["src/lib/stores/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              entryPoints,
              {
                group: ["#lib/stores/**", "#lib/limiter/**"],
                message:
                  "A store imports its own files with ./, and never another store or limiters.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["src/lib/limiter/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              entryPoints,
              {
                group: ["#lib/stores/**", "#lib/transitions/**"],
                message:
                  "Limiters know only the store contract, not a concrete store or its arithmetic.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["src/**/__tests__/**"],
      rules: { "no-restricted-imports": "off" },
    },
    {
      // JSDoc is the only type syntax available in plain JavaScript files.
      files: ["scripts/**/*.mjs"],
      rules: { "jsdoc/check-tag-names": ["error", { typed: false }] },
    },
  ],
  rules: {
    // Also report cycles that pass through type-only imports.
    "import/no-cycle": ["error", { ignoreTypes: false }],
  },
})
