---
name: runcheck-diagnostics
description: Runbook for diagnosing TypeScript errors, Biome linter warnings, Knip unused exports, and Vitest runs.
---

# Runcheck Diagnostics Runbook

Use this skill when you need to check if the codebase is clean, compile typescript, run linter checks, find unused exports, or run test suites.

## Recommended Diagnostics Workflow

Always run checks in this order to save time:

### 1. TypeScript Compilation (Fast check)

Run type checking to verify there are no compilation errors:

```bash
pnpm typecheck
```

If this fails, resolve compile-time type errors or missing import/export errors first. Remember that relative imports in the codebase MUST end with `.js` extensions.

### 2. Linting & Formatting

Run linting to check code style, unused exports, and basic static analysis:

```bash
pnpm lint
```

This command runs Prettier, Biome, and Knip.

- **To fix formatting and lint errors automatically:** Run `pnpm lint:fix`.
- **To resolve Knip errors (unused files/exports):** Remove unused files, delete unused exports, or configure `knip.json` if the export is intentionally public.

### 3. Build Verification

Run the build script to ensure compilation and bundle generation work correctly:

```bash
pnpm build
```

### 4. Running Test Suite

Execute the Vitest test suite to ensure no regressions are introduced:

```bash
pnpm test
```

### 5. Full Validation

Run the complete verification script which chains all the above:

```bash
pnpm check
```

If this passes, the codebase is fully compliant and ready for review/merge.
