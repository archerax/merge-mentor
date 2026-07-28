# Feature Idea: v4 Monorepo Restructure — CLI & Web UI Apps over Shared Libraries

## Executive Summary

**Merge Mentor** is currently a single-package CLI: all source lives under `src/`, gets bundled with esbuild, and ships to npm as one `merge-mentor` package. For the **v4 release**, we restructure the repository into a **pnpm-workspace monorepo** with two first-class applications:

1. **`apps/cli`** — the existing CLI, preserved exactly as users know it today (same `merge-mentor` binary, same commands, same CI behavior).
2. **`apps/web`** — a new browser-based Web UI that exposes the same capabilities through a user-friendly visual interface, realizing the vision already captured in the [Web UI feature idea](file:///root/merge-mentor/ideas/web-ui-feature.md).

Both apps are thin shells: the majority of the functionality — review engines, AI provider clients, platform adapters, configuration, and audit logging — is extracted into **shared libraries** under `libs/*` and consumed identically by both apps.

---

## 🎯 Target Persona & User Story

- **Target Users:**
  - **Developers & CI pipelines** — continue using the CLI exactly as today.
  - **Product Owners, PMs, Engineering Leads** — gain the visual Web UI experience described in the Web UI idea doc, without the CLI becoming bloated.
  - **Contributors & maintainers** — work on a cleanly layered codebase where the core engine is app-agnostic.
- **Problem:**
  - In the current single-package layout, a Web UI would have to be bolted into the CLI package itself — inflating the npm-published binary with a React SPA and web server code that CI users never need.
  - Without enforced library boundaries, the two front-ends would inevitably drift: duplicated orchestration logic, divergent behavior between CLI and UI, and double maintenance.
  - The Web UI and CLI have different release cadences and deployment targets (npm binary vs. embeddable/hosted web app), which a single package cannot express.
- **Goal:**
  - Restructure into `apps/*` (deliverables) and `libs/*` (shared libraries) so the review engine, AI providers, platform adapters, config, and audit infrastructure exist exactly once.
  - Keep the CLI's published artifact lean and 100% backward compatible — the restructure must be invisible to existing users.
  - Give the Web UI a first-class home with its own build, test, and (future) deployment pipeline.

---

## 🛠 MVP Scope & Key Capabilities

### 1. Workspace & Tooling Foundation

- **pnpm workspaces:** Set `pnpm-workspace.yaml` to include both `apps/*` and `libs/*`.
- **Shared TypeScript base:** A root `tsconfig.base.json` extended per package, using TypeScript project references for fast, dependency-aware typechecking.
- **Root orchestration:** Top-level `pnpm -r` scripts (`build`, `test`, `typecheck`, `lint`) so the existing `pnpm check` workflow keeps working unchanged.
- **Quality gates preserved:** Biome, Prettier, Knip, Husky hooks, and Vitest continue to run across the whole workspace.

### 2. Shared Library Extraction (`libs/*`)

Extract the existing `src/` modules into focused, app-agnostic packages:

| Library                   | Extracted from                                                   | Responsibility                                                         |
| :------------------------ | :--------------------------------------------------------------- | :--------------------------------------------------------------------- |
| `@merge-mentor/core`      | `src/review/`                                                    | Review engines (PR, PBI, project), finding aggregation, diff handling. |
| `@merge-mentor/ai`        | `src/ai/`                                                        | AI provider clients, provider factory, prompts, tool schemas.          |
| `@merge-mentor/platforms` | `src/platforms/`                                                 | GitHub & Azure DevOps adapters behind their existing port interfaces.  |
| `@merge-mentor/config`    | `src/config.ts`                                                  | `.env` / `.mergementor` loading, validation (zod), defaults.           |
| `@merge-mentor/audit`     | `src/audit/`                                                     | Audit logging, review history, token-usage records.                    |
| `@merge-mentor/shared`    | `src/utils/`, `src/logger.ts`, `src/errors/`, `src/constants.ts` | Logger, error types, utilities, constants.                             |

- All existing `.spec.ts` files move with their modules — no test is rewritten, only relocated.
- Shared libraries start as **private workspace packages** (not published to npm), consumed via `workspace:*` dependencies.

### 3. CLI App (`apps/cli`)

- A thin [Commander](https://www.npmjs.com/package/commander) entry point (`cli.ts`, `program.ts`, `src/commands/`) that wires shared libraries to terminal commands — no business logic of its own.
- Bundled with esbuild exactly as today and published to npm as the `merge-mentor` package (unchanged name, bin, and version flow per `RELEASE.md`).
- **Zero behavioral change:** identical commands, flags, exit codes, and CI integration. The restructure is purely internal.

### 4. Web UI App (`apps/web`)

- The Web UI described in the [Web UI feature idea](file:///root/merge-mentor/ideas/web-ui-feature.md): Vite + React SPA served by a lightweight Node/Hono server, bound to `127.0.0.1` by default.
- **Feature-parity goal over time:** anything the CLI can do — run PR/PBI/PRD/project reviews, inspect audit history, manage configuration — should be doable from the UI, backed by the exact same shared libraries.
- `merge-mentor ui` keeps working: `apps/cli` depends on the web app package and serves its prebuilt SPA bundle, preserving the command interface (`--port`, `--no-open`) from the original idea doc.

---

## 📐 Technical Architecture & CLI Design

### Target Directory Layout

```
merge-mentor/
├── apps/
│   ├── cli/                    # published to npm as "merge-mentor"
│   │   ├── src/
│   │   │   ├── cli.ts          # bin entry
│   │   │   ├── program.ts      # Commander wiring
│   │   │   └── commands/       # thin command handlers over shared libs
│   │   └── package.json
│   └── web/                    # Web UI app (Vite + React SPA + embedded server)
│       ├── src/
│       └── package.json
├── libs/
│   ├── core/                   # @merge-mentor/core
│   ├── ai/                     # @merge-mentor/ai
│   ├── platforms/              # @merge-mentor/platforms
│   ├── config/                 # @merge-mentor/config
│   ├── audit/                  # @merge-mentor/audit
│   └── shared/                 # @merge-mentor/shared
├── package.json                # private root: orchestration scripts only
└── pnpm-workspace.yaml         # apps/* + libs/*
```

### Package Dependency Graph

```
┌─────────────────┐     ┌─────────────────┐
│    apps/cli     │     │    apps/web     │
│   (Commander)   │     │  (React+Vite)   │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
          ┌─────────────────────┐
          │ @merge-mentor/core  │  review engines & orchestration
          └──────────┬──────────┘
                     │
      ┌──────────────┼──────────────┬──────────────┐
      ▼              ▼              ▼              ▼
┌───────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│    ai     │ │ platforms  │ │   config   │ │   audit    │
└─────┬─────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
      └─────────────┴──────┬───────┴──────────────┘
                           ▼
                ┌─────────────────────┐
                │       shared        │  logger, errors, utils
                └─────────────────────┘
```

Strict layering rule: **apps may depend on libs; libs may never depend on apps.** Enforced via Knip/Biome boundaries plus code review.

### Command Interface

The user-facing surface is unchanged from the Web UI idea doc — only the structure behind it changes:

```bash
# CLI works exactly as before
merge-mentor review --pr 123

# Launch the Web UI (CLI serves the prebuilt apps/web bundle)
merge-mentor ui --port 8080 --no-open

# Standalone dev mode while working on the UI
pnpm --filter @merge-mentor/web dev
```

### Migration Approach (Phased)

1. **Phase 1 — Extract libs in place:** Move `src/` modules into `libs/*` with their specs; root package re-exports as needed. CLI behavior unchanged; full test suite green at every step.
2. **Phase 2 — Create `apps/cli`:** Move the Commander entry/commands; point npm publishing (`files`, `bin`, esbuild bundle) at `apps/cli`. Cut a v4 prerelease for soak testing.
3. **Phase 3 — Scaffold `apps/web`:** Add the Vite + React app and embedded server per the Web UI idea doc, consuming only shared libraries.

---

## 💡 Versioning & Release Strategy

- **v4.0.0** marks the restructure; SemVer rules in `RELEASE.md` continue to apply to the published CLI.
- **Lockstep versioning to start:** all workspace libs share the repo version; only `apps/cli` is published. Internal libs stay private to avoid supporting a public API surface prematurely.
- **Changesets (candidate):** adopt [Changesets](https://github.com/changesets/changesets) if/when apps need independent release cadences or shared libs get published under the `@merge-mentor` scope.
- **Open decision:** whether `apps/web` ships versioned with the CLI (simplest — SPA bundle is a CLI build artifact) or independently (needed later for hosted deployments).

---

## 🗺 Future Roadmap (Post-MVP)

1. **Hosted Enterprise Web UI:**
   - Package `apps/web` as a standalone Docker container with OAuth2/OIDC (GitHub SSO & Azure AD), as outlined in the Web UI idea doc's roadmap — now trivial since the web app no longer depends on the CLI bundle.
2. **Published Shared Libraries:**
   - Promote selected libs (e.g. `@merge-mentor/core`, `@merge-mentor/platforms`) to public npm packages so third parties can build integrations and plugins on the same engine.
3. **Additional App Targets:**
   - The app/lib split makes new front-ends cheap: a VS Code extension, a GitHub App, or a chat-ops bot could all live in `apps/*` reusing the identical shared core.
4. **Build Orchestration Upgrade:**
   - Evaluate Turborepo or Nx for cached, dependency-graph-aware builds if plain `pnpm -r` orchestration becomes a bottleneck as the workspace grows.
