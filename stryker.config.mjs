const breakThreshold = Number.parseFloat(process.env.STRYKER_BREAK_THRESHOLD ?? "0");

const config = {
  $schema: "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "progress", "html"],
  htmlReporter: {
    fileName: "reports/mutation/index.html",
  },
  mutate: [
    "apps/cli/src/**/*.ts",
    "libs/*/src/**/*.ts",
    "!apps/cli/src/**/*.spec.ts",
    "!apps/cli/src/**/*.test-helper.ts",
    "!apps/cli/src/**/types.ts",
    "!libs/*/src/**/*.spec.ts",
    "!libs/*/src/**/*.test-helper.ts",
    "!libs/*/src/**/types.ts",
  ],
  ignorePatterns: ["dist/**", "docs/**", "ideas/**", "assets/**", "reports/**"],
  tempDirName: ".stryker-tmp",
  thresholds: {
    break: Number.isFinite(breakThreshold) ? breakThreshold : 0,
  },
};

export default config;
