import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    isolate: true,
    pool: "threads",
    sequence: {
      concurrent: false,
    },
    testTimeout: 30000,
    hookTimeout: 10000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts"],
      all: true,
    },
  },
});
