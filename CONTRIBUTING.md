# Contributing to Merge Mentor

Thanks for your interest in contributing! This guide covers everything you need to get a change landed.

## Prerequisites

- **Node.js 22+**
- **pnpm** (the repo uses a committed lockfile; npm/yarn are not supported)

## Getting Started

```bash
git clone https://github.com/archerax/merge-mentor.git
cd merge-mentor
pnpm install
```

## Development Workflow

1. **Create a branch** from `main` for your change.
2. **Make your change**, following the conventions below.
3. **Run the full check suite** — this is exactly what CI runs:

   ```bash
   pnpm check
   ```

   This chains `pnpm typecheck` (strict TypeScript), `pnpm lint` (Prettier + Biome + Knip), `pnpm build`, and `pnpm test` (Vitest). All four must pass.

   To auto-fix formatting/lint issues:

   ```bash
   pnpm lint:fix
   ```

4. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/) (see below).
5. **Open a pull request.** A pre-push hook runs `pnpm check` locally, so pushes of failing code will be rejected before CI sees them.

## Conventions

### Code Style

- **Strict TypeScript** — no explicit `any` in production code (Biome enforces `noExplicitAny` and `noNonNullAssertion` as errors).
- **Relative imports must end with `.js`** (ESM), e.g. `import { foo } from "./bar.js"`.
- **Hexagonal architecture** — core logic depends on ports (`src/ports/`), not concrete I/O. Use the existing `FileSystem`, `ProcessRunner`, `Clock`, and `OutputWriter` ports instead of calling `node:fs`/`child_process` directly; each port has a `*.test-helper.ts` fake for tests.
- **Errors** — throw the typed errors from `src/errors/` (e.g. `AIProviderError`, `ConfigurationError`), not raw `Error`, and preserve the original error via `cause`.

### Security

- **Never interpolate untrusted content** (PR titles/descriptions/diffs, review comments, work-item fields) into AI prompts without the defenses in `src/ai/prompts/securityPreamble.ts` (`buildSecurityPreamble()` + `wrapUntrustedContent()`).
- **AI agent tools stay least-privilege** — shell/write tools are never auto-approved for flows that ingest untrusted input.
- **No telemetry** — the only outbound calls are the platform APIs and the configured AI endpoint.
- Report vulnerabilities privately per [SECURITY.md](./SECURITY.md) — never in a public issue.

### Tests

- Colocate specs with source as `*.spec.ts`; run with `pnpm test`.
- Coverage thresholds (80% lines/functions/branches/statements) are enforced via `pnpm test:coverage` — don't let coverage drop.
- Tests must be hermetic: mock only true external boundaries (platform APIs, AI SDKs), use the port test-helper fakes, and never write into the repository working directory (use `os.tmpdir()` for filesystem tests, with cleanup).

### Changelog

User-facing changes need an entry in [CHANGELOG.md](./CHANGELOG.md) under `[Unreleased]`, following [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) (`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`). Releases follow [Semantic Versioning](https://semver.org/); see [RELEASE.md](./RELEASE.md).

### Commits

Use Conventional Commits, matching the existing history:

- `feat:` new features · `fix:` bug fixes · `docs:` documentation · `style:` formatting · `refactor:` code restructuring · `test:` tests · `chore:` maintenance

Examples: `feat(fix): support resolving threads on Azure DevOps`, `fix(security): wrap untrusted PBI fields in alignment prompt`.

## Project Direction

The current quarter's priorities and explicitly-out-of-scope work are in [`plans/roadmap-q3-2026.md`](./plans/roadmap-q3-2026.md). If you want to work on something large, open an issue first to check it fits the roadmap before investing time.

## Questions?

Open a [GitHub issue](https://github.com/archerax/merge-mentor/issues) — for bugs, include the command you ran, the output, and your merge-mentor version (`npx merge-mentor --version`).
