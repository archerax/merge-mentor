# Merge Mentor Agent Instructions

## Commands

```bash
pnpm typecheck        # Check TypeScript compilation (fast, no-emit)
pnpm build            # Compile TypeScript
pnpm test             # Run unit tests with Vitest
pnpm lint             # Check formatting (Oxfmt) + linting (Oxlint) + unused code (Knip)
pnpm lint:fix         # Auto-fix formatting and linting errors
pnpm check            # Full validation suite (typecheck + lint + build + test)
```

## Project Structure

This repo is a pnpm workspace whose packages live under `apps/*` and `libs/*`. Shared libraries are consumed as TypeScript source via `workspace:*` dependencies, `tsconfig.base.json` `paths`, and matching Vitest aliases — there is no per-library build step. The root `build`, `test`, `typecheck`, and `lint` scripts run the root package first, then recursively (`--if-present`) across every workspace package, so `pnpm check` keeps working unchanged.

Packages (dependency direction: `shared` ← `core` ← root CLI):

- `libs/shared/src/` (`@merge-mentor/shared`) – Foundation with no upward deps: `errors/`, `ports/`, `logger.ts`, `audit/`.
- `libs/core/src/` (`@merge-mentor/core`) – Review engine and integrations: `ai/`, `review/`, `platforms/`, `config.ts`, `constants.ts`, `utils/`.
- `src/` – CLI entrypoint, Commander commands, `ci/`, `build/`, and `eval/` support code. This will move to `apps/cli` in a later phase.

Cross-package imports MUST use the `@merge-mentor/shared/...` or `@merge-mentor/core/...` aliases (keeping `.js` extensions). Relative imports are only for files within the same package. `libs/*/package.json` versions are kept in lockstep with the root version because `libs/core/src/review/*` reads its own `package.json` for the version footer.

## Tech Stack

TypeScript 6.x (strict mode), Node.js (ES Modules), pnpm, Vitest, Oxlint linter, Oxfmt formatter, Knip

## Code Style

**ES Modules Requirement:**

- Because this project is an ES Module (`"type": "module"`), all internal imports **MUST** include the `.js` extension (e.g., `import { logger } from "./logger.js"`). Do not omit extensions or use `.ts`.

**Oxlint Rules:**

- **No Unused Variables:** Treated as errors. Remove unused imports and local variables.
- **No Non-null Assertions:** Do not use `!` to bypass TypeScript checks.
- **No Explicit any:** Do not use `any` unless absolutely necessary and documented.

**Good:**

```typescript
import { ValidationError } from "@merge-mentor/shared/errors/index.js";
import type { File } from "./types.js";

async function fetchPullRequestFiles(owner: string, repo: string): Promise<File[]> {
  if (!owner) throw new ValidationError("owner", "Required");
  return api.getFiles(owner, repo);
}

function calculateScore(factors: Factor[]): "high" | "medium" | "low" {
  const total = factors.reduce((sum, f) => sum + f.weight, 0);
  if (total >= 0.8) return "high";
  if (total >= 0.5) return "medium";
  return "low";
}
```

**Bad:**

```typescript
// Missing .js extension, uses any, and fails Oxlint/strict rules
import { getFiles } from "./api";

async function get(x: any): any {
  return getFiles(x);
}

function calc(x) {
  return x.score >= 80 ? 1 : x.score >= 50 ? 2 : 3;
}
```

**Naming:** camelCase for functions/variables, PascalCase for classes/interfaces, UPPER_SNAKE_CASE for constants. Use type guards. Always handle errors explicitly.

## Boundaries & Custom Workspace Rules

✅ **Always:**

- Write TypeScript in strict mode
- Use explicit `.js` extensions for relative imports
- Run `pnpm check` to verify your changes before submitting
- Write unit tests (`*.spec.ts`) in the same directory as the code they test
- Use `process.cwd()` for configs and logs to support global installation
- Explicitly catch and map external errors to custom exceptions in `src/errors/`

⚠️ **Ask First:**

- Adding new dependencies
- CLI interface changes
- Platform adapter modifications
- Review engine refactoring

🚫 **Never:**

- Edit `node_modules/`, `dist/`, `pnpm-lock.yaml`
- Use `any` without strong, documented justification
- Remove or bypass failing tests
- Leave raw `console.log` in production code (use the proxy `logger` instead)
- Commit code without explicit user permission

💡 **Best Practices Safeguard:**

- If the user proposes a solution or requests a task that contradicts industry best practices or seems unnecessarily complex (like using Assembly for a web server), stop, explain why it's unwise, and suggest a better alternative before proceeding.
