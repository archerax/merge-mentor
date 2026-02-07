# Merge Mentor Agent Instructions

## Commands

```bash
pnpm build            # Compile TypeScript
pnpm test             # Run unit tests
pnpm test:integration # Run integration tests
pnpm lint             # Lint with Biome
pnpm check            # Build + test + lint
```

## Project Structure

- `src/ai/` – AI provider abstraction (Copilot, OpenCode, Cursor)
- `src/platforms/` – GitHub & Azure DevOps adapters
- `src/review/` – Review engine, comment management, deduplication
- `src/audit/` – Audit logging for security/compliance
- `src/` – CLI, config, logger, error handling, utilities
- `tests/integration/` – End-to-end tests with mocked dependencies

## Tech Stack

TypeScript 5.x (strict mode), Node.js, pnpm, Vitest, Biome linter

## Code Style

**Good:**

```typescript
async function fetchPullRequestFiles(
  owner: string,
  repo: string,
): Promise<File[]> {
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
async function get(x: any): any {
  return api.getFiles(x);
}

function calc(x) {
  return x.score >= 80 ? 1 : x.score >= 50 ? 2 : 3;
}
```

**Naming:** camelCase for functions, PascalCase for classes, UPPER_SNAKE_CASE for constants. Avoid `any`. Use type guards. Always handle errors.

## Boundaries

✅ **Always:**

- Write TypeScript with strict mode
- Run `pnpm check` to verify changes
- Write tests with code
- Use `process.cwd()` for config/logs (supports global install)
- Handle errors explicitly

⚠️ **Ask First:**

- New dependencies
- CLI interface changes
- Platform adapter modifications
- Review engine refactoring

🚫 **Never:**

- Edit `node_modules/`, `dist/`, `pnpm-lock.yaml`
- Use `any` without justification
- Remove failing tests
- Leave `console.log` in production code
- Commit code without explicit permission
