# Feature Plan: Web UI State Management (TanStack Query and Zustand)

> **Status: implemented.** All three phases have landed. The conventions are
> documented in [`apps/web/README.md`](../apps/web/README.md). Differences from
> this plan: the SSR integration (`@tanstack/react-router-ssr-query`) provides
> `QueryClientProvider`, so `__root.tsx` does not add one; the stats page reads
> its query with `useQuery` (suspense ignores `placeholderData`) and its loader
> only waits on entry, not on window changes.

## Overview

The web UI (`apps/web`) uses Zustand in one place (`stores/reviewForms.ts`, which
keeps review form inputs across navigation) and TanStack Router loaders for page
data. `@tanstack/react-query` is not installed. Several components hand-roll
fetching and mutation state, and most UI state resets on navigation.

## Problems

1. **Hand-rolled fetching.** `AiStatusBar.tsx` uses `useState`, `useEffect` and
   `useCallback` with no shared cache or dedupe. `useReviewStream.ts` (run lookup)
   and `usePostComments.ts` call raw `fetch()` with manual state.
2. **Loader data mirrored into local state.** `routes/reports.tsx` copies loader
   results into `useState` (reports, selected, loadingName, deleting,
   deleteError) and remounts via `key=` to resync.
3. **Crude polling.** `routes/outcomes.tsx` uses `router.invalidate()` on an
   interval, which re-runs every active loader, with `staleTime: 0`.
4. **Inconsistent UI state persistence.** Review forms survive navigation, but the
   audit filters, reports search, config tab and "show advanced", and PRD runner
   options reset.
5. **No optimistic updates or cache invalidation.** Config save, report delete and
   comment posting use manual status flags.

## Principle

Server data lives in TanStack Query. UI and form state lives in Zustand. Never
copy query results into stores.

## Phase 0: Foundation

1. Add `@tanstack/react-query` to `apps/web`. Add
   `@tanstack/react-router-ssr-query` only if the SSR integration needs it
   (confirm during implementation).
2. In `router.tsx`, create a `QueryClient` per `getRouter()` call so SSR requests
   do not share a cache. Defaults: `staleTime: 30_000`, `retry: 1`,
   `refetchOnWindowFocus: true`. Pass it via router `context` and wrap the app in
   `QueryClientProvider` in `__root.tsx`.
3. Add `src/queries/`, one file per domain, with `queryOptions` and key factories
   (`aiStatusQuery`, `reportsQuery`, `reportQuery(name)`, `outcomesQuery`,
   `runQuery(id)`). Loaders call `queryClient.ensureQueryData(...)`; components use
   `useQuery` or `useSuspenseQuery` on the same options.
4. Test setup: a `renderWithQuery` helper (fresh client, `retry: false`) for the
   existing `*.spec.tsx` files.

## Phase 1: TanStack Query migrations

| Target                | Change                                                                                                                                                                                                  | UX win                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `AiStatusBar.tsx`     | `useQuery(aiStatusQuery)`; refresh button calls `refetch()` with `force: true`. Remove `useState`/`useEffect`/`useCallback`. Keep the `copilot-error` fallback via `select`/error handling.             | Cached across navigation, deduped, no flash of "unknown" on mount.       |
| `routes/reports.tsx`  | List and single report become queries. Delete becomes `useMutation` with optimistic list update, rollback on error, invalidate on settle. Remove loader-to-`useState` mirroring and the `key=` remount. | Instant delete, no stale local copy, report switching served from cache. |
| `routes/outcomes.tsx` | Replace the `router.invalidate()` interval with `refetchInterval` active only while `scan.running`. Starting a scan becomes a mutation that invalidates the outcomes query. Drop `staleTime: 0`.        | Polls only that data, pauses in background tabs.                         |
| `usePostComments.ts`  | `useMutation` exposing `isPending`/`error`; on success invalidate posted-comments and run queries.                                                                                                      | Removes manual status flags; posted state stays consistent.              |
| `useReviewStream.ts`  | Move only the run lookup (`/api/review/runs/:id`) to `useQuery`. Keep streaming/SSE logic as is (does not fit Query).                                                                                   | Revisiting a finished run is instant.                                    |

Keep route loaders for `audit`, `config` and `stats`, but use `ensureQueryData` so
preload-on-intent fills the same cache. Config save becomes a mutation with
invalidate.

## Phase 2: Zustand for UI state that should survive navigation

1. Add a `persist` store (`sessionStorage`, with `version` and `partialize`) for:
   - Audit log: severity filter and search text.
   - Reports: search query and last selected report.
   - Config: active tab and "show advanced".
   - PRD runner: document type, include-images, annotate (never the `File`).
2. Move the existing `reviewForms` store onto the same `persist` setup so inputs
   survive a full reload. Ensure `write` defaults safely on rehydrate.
3. Use selector hooks (as `reviewForms.ts` does) so components re-render only on
   the slices they use.

## Phase 3: Polish

- `placeholderData: keepPreviousData` for `stats` day-range switching.
- Mantine skeletons via `pendingComponent`/Suspense, and consistent error
  boundaries with a retry button that calls `reset`.
- Query devtools in development only.
- Document conventions (queries in `src/queries`, UI state in `src/stores`).

## Delivery order

1. PR 1: Phase 0 plus the `AiStatusBar` migration (proves the setup).
2. PR 2: `reports` and `outcomes`.
3. PR 3: `usePostComments`, the run lookup and the config mutation.
4. PR 4: Zustand persistence (Phase 2).
5. PR 5: Phase 3 polish.

## Risks

- **SSR with TanStack Start:** a per-request `QueryClient` and correct
  dehydration are required to avoid cache leaks between requests or hydration
  mismatches. Verify in Phase 0 before migrating anything.
- **Server functions as `queryFn`:** call them directly as the current code does.
  Preserve error-to-state behaviour such as `AiStatusBar`'s `copilot-error`.
- **Persisted state:** keep it small and versioned; never store file contents or
  tokens.
- **Existing specs:** `AiStatusBar`, `ReviewRunner` and `PrdReviewRunner` specs
  need the query-client wrapper. Run lint, typecheck, tests and `knip` at each PR.
