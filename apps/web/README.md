# Merge Mentor web dashboard (`@merge-mentor/web`)

The local dashboard launched by `merge-mentor ui` (see [docs/ui.md](../../docs/ui.md)
for how to use it). It is a [TanStack Start](https://tanstack.com/start) app
with Mantine for the UI.

## Development

```bash
pnpm --filter @merge-mentor/web dev        # Vite dev server on http://localhost:3000
pnpm --filter @merge-mentor/web build      # production build into apps/web/.output
pnpm --filter @merge-mentor/web typecheck  # regenerates routeTree.gen.ts, then tsc
```

From the repository root, `pnpm check` runs the typecheck, lint, build and test
steps of CI (CI also runs the coverage gate, `pnpm audit` and the CLI smoke tests).
`tsr generate` (part of `typecheck`) rewrites `src/routeTree.gen.ts` without its
TanStack Start block, and `pnpm build` puts it back; commit the built version.

In development the TanStack Query devtools are available from the floating
button at the bottom left. They are loaded lazily behind `import.meta.env.DEV`,
so they are not in the production bundle.

## Layout

| Path              | What lives there                                                            |
| ----------------- | --------------------------------------------------------------------------- |
| `src/routes/`     | File-based routes. Loaders fill the query cache; pages read from it.        |
| `src/queries/`    | Server data: TanStack Query `queryOptions` and `mutationOptions`, by domain |
| `src/stores/`     | UI state that should survive navigation or a reload (Zustand)               |
| `src/components/` | Shared components, including `PageSkeleton` and `RouteError`                |
| `src/server/`     | Server functions (`*.functions.ts`) and server-only code (`*.server.ts`)    |
| `src/test/`       | Test helpers, e.g. `renderWithQuery`                                        |

## State management conventions

**Server data lives in TanStack Query. UI and form state lives in Zustand.
Never copy query results into a store** (or into `useState`): read them from the
query wherever they are needed. One exception remains: `ReviewRunner` still
fetches the review cache status in a `useEffect` and keeps it in `useState`;
it is not yet migrated to a query.

### Queries (`src/queries/<domain>.ts`)

- One file per domain. Export `queryOptions` constants or functions
  (`reportsQuery`, `reportQuery(name)`, `statsQuery(days)`), and keep the key
  factory (`const reportsKeys = { ... }`) unexported, so every caller goes
  through the same options and keys.
- Server functions are called directly as the `queryFn`. Expected failures that
  the page explains itself (for example `{ ok: false, error }` from stats or
  outcomes) are returned as data, not thrown.
- The router creates a fresh `QueryClient` per request in `src/router.tsx`
  (defaults: `staleTime` 30 s, `retry` 1, refetch on focus) and
  `@tanstack/react-router-ssr-query` dehydrates it into the HTML. Never create a
  module-level `QueryClient`: SSR requests would share a cache.
- Route loaders call `context.queryClient.ensureQueryData(query)` so SSR and
  preload-on-intent fill the cache; the page then calls `useSuspenseQuery` with
  the same options.
- `runQuery` fetches `/api/review/runs/:id` with a relative URL, so it is
  client-only: use it from components, not from a loader or during SSR.
- When the page should keep showing old data while new data loads (the stats
  window picker), give the query `placeholderData: keepPreviousData`, read it
  with `useQuery` (suspense ignores placeholder data), and only await the loader
  on entry (`cause !== "stay"`). Use `isPlaceholderData` to show that it is
  updating.
- Polling belongs on the query (`refetchInterval`), not on `router.invalidate()`.

### Mutations

- Export `mutationOptions` next to the queries they affect (for example
  `deletePrdRunMutation` in `queries/reports.ts`) and use them with
  `useMutation(...)`. Use `isPending` and `error` instead of hand-written status
  flags.
- Invalidate or update the affected queries in the mutation's `onSuccess` or
  `onSettled`, using the `client` from the mutation context. For optimistic
  updates, cancel the query, snapshot it in `onMutate`, roll back in `onError`
  and invalidate in `onSettled`.

### Loading and errors

- Query-backed routes set `pendingComponent` to a `PageSkeleton` shaped like
  the page; it shows when a navigation waits for the loader.
- Every route uses the shared `RouteError` (the router's
  `defaultErrorComponent`). Its **Try again** button resets the query error
  boundary, resets the route error boundary and re-runs the loaders. Keep
  inline errors where the page has something specific to say (for example
  "Could not load outcomes" with a link to the configuration).

### UI state (`src/stores/`)

- Create stores that should survive navigation or a reload with
  `createPersistedStore` from `stores/persisted.ts`. It saves to
  `sessionStorage` (or `localStorage` with `area: "local"`) under
  `merge-mentor:<name>`, with a `version`, a `partialize` that picks the saved
  fields and a `sanitize` that turns whatever is in storage back into
  well-formed fields.
- Stores skip hydration and start from their defaults, so the server HTML and
  the first client render match. `__root.tsx` calls `hydratePersistedStores()`
  after hydration to apply saved values. Saved values therefore appear one
  render after hydration; that is a deliberate trade for never causing a
  hydration mismatch.
- Expose selector hooks (`useReportsQuery()`, `useReportPick()`) so components
  re-render only for the slice they use.
- Never persist files or their contents, tokens or keys, or anything that acts
  on the user's behalf (the review forms' `write` switch is never saved and
  always starts off). The same goes for options that send data to the AI
  provider (the PRD runner's "include images"); the Word-copy option, strategy
  and review runs (capped at `MAX_REVIEW_RUNS`) only change local output or AI
  cost, so they are saved. Keep persisted state small, and bump `version` when
  its shape changes.

## Tests

Specs sit next to the code as `*.spec.ts(x)`. Components are tested by static
rendering: `renderWithQuery(ui, queryClient?)` from
`src/test/renderWithQuery.test-helper.tsx` renders inside Mantine and a fresh
`QueryClient` with retries off. Seed it with `queryClient.setQueryData(...)` to
render loaded states; static rendering never runs query functions.
