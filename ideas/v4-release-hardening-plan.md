# Plan: v4 Release Hardening (Project References, Localhost Binding, `--no-open`)

Close the remaining gaps between the shipped monorepo layout and the v4 release
intent before cutting `4.0.0`:

1. Adopt **TypeScript project references** so typechecking is dependency-aware
   and incremental.
2. Make the bundled web dashboard bind to **loopback (`127.0.0.1`) by default**.
3. Support the documented **`--no-open`** flag on `merge-mentor ui`.

Each item is independently shippable and none of them touches the review engines
in `libs/core`.

## Problem

The v4 restructure (documented in the now-completed
`ideas/v4-monorepo-restructure.md`) promised three things that are still missing
or inconsistent on `main`:

- **Project references.** `tsconfig.base.json` defines only path aliases; no
  `composite`/`references`/`tsBuildInfoFile` exists anywhere
  (`tsconfig.base.json`, `tsconfig.json`, `apps/*/tsconfig.json`,
  `libs/*/tsconfig.json`). Typecheck is a single root `tsc --noEmit` plus a
  `pnpm -r` pass — no incremental, dependency-aware builds.
- **Localhost-only binding.** The web-ui design calls for binding exclusively to
  `127.0.0.1`. Today `merge-mentor ui` only sets `HOST` when `--host` is passed
  (`apps/cli/src/commands/ui.ts:115`), and Nitro's node-server runtime passes
  `hostname: undefined` (`node_modules/.../nitro/dist/presets/node/runtime/node-server.mjs:12,19`),
  so Node listens on **all interfaces** by default.
- **`--no-open` flag.** The documented interface is
  `merge-mentor ui --port 8080 --no-open`, but only `--open` (default `false`)
  is defined (`apps/cli/src/program.ts:582`, `docs/ui.md`). Passing `--no-open`
  errors with "unknown option".

---

## Part 1 — TypeScript project references

### Current state

- `tsconfig.base.json` — shared `compilerOptions` (already sets `declaration`,
  `declarationMap`, `sourceMap`) plus the `@merge-mentor/*` path aliases.
- Root `tsconfig.json` — extends base, `include: ["apps/cli/src/**/*", "libs/*/src/**/*.d.ts"]`.
- Per-package `tsconfig.json` — extend base, `include: ["src/**/*"]`; `apps/web`
  defines its own browser-oriented config.
- Root scripts: `typecheck:root` = `tsc --noEmit`; `typecheck` = root + `pnpm -r`.

### Target dependency graph

```
shared ─┬─> domain
        ├─> config
        ├─> platforms ─> domain
        └─> core ─> domain, config, platforms, shared
                 apps/cli ─> core, domain, config, platforms, shared
                 apps/web ─> core, domain, config, platforms, shared
```

### Steps

1. Add to each `libs/*/tsconfig.json` and `apps/cli/tsconfig.json`:
   ```jsonc
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": {
       "composite": true,
       "rootDir": "src",
       "outDir": "dist-types",
       "tsBuildInfoFile": "dist-types/.tsbuildinfo",
     },
     "include": ["src/**/*"],
   }
   ```
2. Add `references` to each project for its internal deps (e.g. `libs/core`
   references `../shared`, `../domain`, `../config`, `../platforms`).
3. Make root `tsconfig.json` a solution file that only lists `references` to every
   package (drop the broad `include`).
4. Switch the typecheck scripts to build mode:
   - `typecheck:root`: `tsc --build --force` (or `tsc --build` and rely on
     `.tsbuildinfo` for incrementality).
   - Keep `pnpm -r typecheck` working, or replace it with the single root
     `tsc -b`.
5. Gitignore the emitted `dist-types/` and `*.tsbuildinfo`.
6. Leave the runtime/test resolvers alone — Vitest aliases (`vitest.config.ts`),
   Vite aliases (`apps/web/vite.config.ts`), and esbuild (`build.mjs`) resolve
   source directly and are unaffected by references.

### Decision to confirm

`composite: true` forbids `noEmit`, so `tsc -b` must emit something. Options:

- **A (recommended):** emit declarations only to a throwaway `dist-types/` via
  `emitDeclarationOnly` + `outDir`, deleted/ignored. Gives true incremental
  `.tsbuildinfo` behavior with no shipped artifacts.
- **B:** use TypeScript 6's build-mode no-emit support (`tsc -b --noEmit`) if it
  behaves correctly for composite projects; verify before relying on it.

Confirm which the installed `typescript@^6.0.3` supports before implementing.

---

## Part 2 — Default bind to localhost only

### Current state

- `apps/cli/src/program.ts:580-582` defines `--port`, `--host`, `--open`.
- `apps/cli/src/commands/ui.ts:94-133` spawns the baked Nitro entry with `PORT`
  always and `HOST` only when `options.host` is set (line 115).
- Nitro reads `process.env.NITRO_HOST || process.env.HOST` and passes it as
  `hostname`; when unset, Node listens on every interface.
- `docs/ui.md` advertises `--host 0.0.0.0` for containers.

### Design

- Default the child `HOST` to `127.0.0.1` when `--host` is not provided:
  ```ts
  env: {
    ...process.env,
    PORT: String(port),
    HOST: options.host ?? DEFAULT_UI_HOST,
    NITRO_HOST: options.host ?? DEFAULT_UI_HOST,
  }
  ```
  (`DEFAULT_UI_HOST = "127.0.0.1"` alongside `DEFAULT_UI_PORT`.)
- Keep `--host` as the explicit opt-in for `0.0.0.0` / container use.
- Print the actual bind address in the startup log (e.g.
  `Starting merge-mentor dashboard on http://127.0.0.1:3000`), so an accidental
  network exposure is obvious.
- Update `docs/ui.md`: state the loopback default, keep the `--host 0.0.0.0`
  container example, and note that the dashboard has no auth (local-only).

### Notes

- Also set `NITRO_HOST`/`NITRO_PORT` to be robust to Nitro preset changes, since
  it checks `NITRO_HOST` first.

---

## Part 3 — `--no-open` flag

### Current state

- `apps/cli/src/program.ts:582`: `.option("--open", "...", false)`.
- `apps/cli/src/commands/types.ts:405-412`: `UiOptions.open?: boolean`.
- `apps/cli/src/commands/ui.ts:130-132`: opens the browser after 1.5s when
  `options.open`.

### Design

Adopt Commander's dual positive/negative boolean so both forms are accepted and
share one value (`node_modules/commander/lib/option.js:263`):

```ts
.option("--open", "Open the dashboard in the default browser")
.option("--no-open", "Do not open the dashboard in the default browser")
```

`/no-open` sets `options.open = false`; the pair shares the `open` attribute.

### Decision to confirm — default behavior

`--no-open` only makes sense if opening is the default. Two options:

- **A (recommended):** default to opening in a browser, and let `--no-open`
  suppress it. Also force `open = false` when `!process.stdout.isTTY` (CI,
  pipes) or when `--host` binds a non-loopback address, so automation and
  container runs never try to spawn a browser. This matches the documented
  `--no-open` interface.
- **B:** keep the current default (do not open) and accept `--no-open` purely as
  a documented no-op alias for compatibility. Lower risk, but the flag has no
  effect.

Recommend A. Update `docs/ui.md` options table and examples accordingly.

---

## Verification

- **Part 1:** `pnpm typecheck` passes; touching a leaf lib and re-running
  typechecks only its dependents (`.tsbuildinfo` proves incrementality).
  `pnpm build && pnpm test` remain green.
- **Part 2:** extend `apps/cli/src/commands/ui.spec.ts` — assert the spawn env
  contains `HOST: "127.0.0.1"` by default and `HOST: "0.0.0.0"` with `--host`.
  Manual: `merge-mentor ui` and confirm `ss -ltn` shows a `127.0.0.1:3000`
  listener, not `0.0.0.0`/`::`.
- **Part 3:** add a spec asserting `--no-open` parses (no "unknown option") and
  results in no browser spawn, while the default behavior matches the chosen
  decision.
- Run `pnpm check` (typecheck, lint, build, test) before finishing.

## Sequencing & risk

1. **Part 2** — smallest, highest security value; localhost default.
2. **Part 3** — small CLI + docs change.
3. **Part 1** — largest; touches every tsconfig and the typecheck scripts.
   Land last, in isolation, and verify the full CI matrix (Windows/macOS build
   paths are sensitive to `outDir`/reference changes).

**Main risk (Part 1):** composite projects break if any project is missing from
the reference graph or if `apps/web`'s bundler-mode tsconfig can't participate.
If `apps/web` proves awkward, exclude it from the references graph and keep its
standalone `tsc --noEmit` typecheck.

## Decisions to confirm

- **Project references emit strategy:** declarations to `dist-types/` (A) vs
  TS6 build-mode no-emit (B).
- **`ui` open default:** open-by-default + `--no-open` (A) vs keep closed and
  treat `--no-open` as an alias (B).
- **`apps/web` inclusion** in the references graph.
