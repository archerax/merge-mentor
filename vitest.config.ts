import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const sharedSrc = fileURLToPath(new URL("./libs/shared/src", import.meta.url));
const configSrc = fileURLToPath(new URL("./libs/config/src", import.meta.url));
const coreSrc = fileURLToPath(new URL("./libs/core/src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@merge-mentor\/shared\/(.*)\.js$/, replacement: `${sharedSrc}/$1.ts` },
      { find: /^@merge-mentor\/config\/(.*)\.js$/, replacement: `${configSrc}/$1.ts` },
      { find: /^@merge-mentor\/core\/(.*)\.js$/, replacement: `${coreSrc}/$1.ts` },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["apps/cli/src/**/*.spec.ts", "libs/*/src/**/*.spec.ts"],
    isolate: true,
    pool: "threads",
    sequence: {
      concurrent: false,
    },
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["apps/cli/src/**/*.ts", "libs/*/src/**/*.ts"],
      exclude: [
        "apps/cli/src/**/*.spec.ts",
        "apps/cli/src/**/*.test-helper.ts",
        "apps/cli/src/**/types.ts",
        "apps/cli/src/cli.ts",
        "apps/cli/src/program.ts",
        "libs/*/src/**/*.spec.ts",
        "libs/*/src/**/*.test-helper.ts",
        "libs/*/src/**/types.ts",
      ],
      all: true,
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
