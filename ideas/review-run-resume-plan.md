# Review Run Resume Plan

Make an in-progress (or finished) review survive a browser refresh: give each
review run a unique, URL-addressable id, move run ownership from the HTTP
connection to a server-side registry, and rehydrate the runner UI from a
persisted event log on load.

## Problem

Reviews have no unique per-run identity and no server-side lifecycle. Today:

- The only id is a deterministic **target** id (`Github-owner-repo-PR42`) built by
  `generatePRIdentifier` in `libs/shared/src/utils/prIdentifier.ts:46`. It
  identifies the PR, is reused across runs, and is overwritten each time.
- All live run state lives in React `useState` inside
  `apps/web/src/components/review/useReviewStream.ts:160` and is reset on mount;
  the form store uses plain Zustand with no `persist`
  (`apps/web/src/stores/reviewForms.ts:31`).
- The route is static with no path/search params
  (`apps/web/src/routes/review.tsx:7`, `apps/web/src/routeTree.gen.ts:24`), so a
  refresh lands on an empty form.
- The run is owned by the HTTP request: `createReviewStream` calls
  `engine.reviewPR(...)` inside the SSE `ReadableStream.start`
  (`apps/web/src/server/review.server.ts:250`, `apps/web/src/server/sse.server.ts:49`).
  When the browser refreshes, the fetch is aborted and the run has no independent
  owner to keep going or to replay from.

To "refresh and resume" we need four things: (a) a unique per-run review id,
(b) URL search-param state carrying that id, (c) server-side run ownership +
persisted event history, and (d) client rehydration/reconnect on load.

---

## Design

Split the single POST-SSE call into a **create** step and a **stream/attach**
step, with a server-side `ReviewRunRegistry` that owns execution and appends every
emitted frame to a durable event log.

```
POST /api/review/stream        -> { runId }         (creates/attaches a run)
GET  /api/review/stream?run=ID -> SSE (replay backlog + live frames)
GET  /api/review/runs/ID       -> RunSnapshot        (status + summary, no stream)
```

The client creates a run, pushes `?run=<id>` into the URL, and always renders by
subscribing to the GET stream. A refresh re-reads the id from the URL and
re-attaches, replaying the backlog. A finished run replays to completion from the
log without re-running any AI work.

### Run identity

- New helper, e.g. `libs/shared/src/utils/reviewRunId.ts`:
  ```ts
  export function generateReviewRunId(targetId: string): string {
    // Sortable prefix + unguessable suffix, URL-safe.
    return `${targetId}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  }
  ```
  Include the human-readable target id for debuggability; the UUID suffix keeps it
  unique across repeated runs and unguessable for local multi-user setups.
- Optionally also expose a stable `targetKey` (the existing `generatePRIdentifier`
  output, or the `postedTargetKey` shape from
  `apps/web/src/server/postedComments.server.ts:34`). The registry uses `targetKey`
  to prevent duplicate concurrent runs for the same PR — if a run is already
  active for a target, **return the existing `runId` instead of starting a new
  run**. This means that even if the URL is lost, re-submitting the same PR
  reattaches to the in-flight run.

### Persistence model

Store runs under the existing temp tree so they sit beside reports and caches:

```
.mergementor/runs/<runId>/
  manifest.json   # targetKey, kind, input, target meta, createdAt, status
  events.jsonl    # one ReviewStreamEvent per line, each with a seq number
  summary.json    # final result frame (written once when the run completes)
```

- Reuse `resolveTempPath()` (`apps/web/src/server/env.server.ts:95`) and the
  `readReport`/`listReports` patterns in `libs/shared/src/reports`.
- `events.jsonl` is append-only and cheap; `manifest.json`/`summary.json` are
  atomically rewritten (temp file + rename, mirroring `writeEnvValues` at
  `env.server.ts:146`).
- This makes runs survive a **server process restart**, not just a page refresh.

---

## Part 1 — Server: run registry (`apps/web/src/server`)

### 1a. `reviewRunStore.server.ts` (new)

Durable read/write of the layout above:

```ts
export interface ReviewRunManifest {
  readonly runId: string;
  readonly kind: "pr" | "pbi" | "project";
  readonly targetKey: string;
  readonly input: unknown;            // original stream input, for resume/post-comments
  readonly label: string;             // e.g. "PR #42 · owner/repo"
  readonly createdAt: number;
  readonly status: "running" | "done" | "error";
}

appendEvent(runId, seq, event): void
readEvents(runId, fromSeq?): ReviewStreamEvent[]
writeSummary(runId, summary): void
readSummary(runId): TResult | null
writeManifest(runId, manifest): void
readManifest(runId): ReviewRunManifest | null
listRuns(limit?): ReviewRunManifest[]
pruneRuns(maxAgeMs, maxCount): void
```

### 1b. `reviewRuns.server.ts` (new) — the registry

Owns execution independently of any HTTP response:

```ts
interface LiveRun {
  readonly runId: string;
  readonly targetKey: string;
  readonly subscribers: Set<(event: ReviewStreamEvent, seq: number) => void>;
  status: "running" | "done" | "error";
  lastSeq: number;
  summary?: unknown;
}

const active = new Map<string, LiveRun>(); // runId -> live run
const activeByTarget = new Map<string, string>(); // targetKey -> runId

export function startOrAttach(kind, input): { runId: string; attached: boolean };
export function subscribe(runId, fromSeq, onEvent): () => void; // returns unsubscribe
export function getSnapshot(runId): { manifest; events; summary } | null;
```

- `startOrAttach` resolves the target first (reusing `resolveTarget` from
  `review.server.ts:56`) to compute `targetKey`. If `activeByTarget` has a
  running run, return it. Otherwise generate a `runId`, write the manifest, and
  kick off the engine via `void execute(run)` — **not** inside the response stream.
- `execute` wraps the existing engine/emit code from `createReviewStream`
  (`review.server.ts:250-314`). Each emitted frame is assigned `seq = ++lastSeq`,
  appended to `events.jsonl`, and fanned out to subscribers. On completion it
  writes `summary.json`, sets `status`, and clears the target lock.
- Failed/aborted runs: persist an `error` frame + `status: "error"` so a refresh
  shows the error rather than hanging.

### 1c. Adapt the route handlers (`apps/web/src/routes/api`)

- `POST /api/review/stream` (`routes/api/review/stream.ts`): body is the current
  `ReviewStreamInput`. Call `startOrAttach("pr", input)` and return
  `{ runId }` JSON (fast, no streaming). Do the same for the PBI and project
  endpoints.
- `GET /api/review/stream?run=<id>&from=<seq>`: validate `run`, then return an SSE
  `ReadableStream` that first replays persisted events with `seq > from`, then
  subscribes to live events. Implement as a thin SSE `ReadableStream` that emits
  an SSE `id:` per frame so browsers natively support `Last-Event-ID`
  reconnection (see `streamRun` in `reviewRuns.server.ts`). Close the stream
  after the terminal `done`/`error` frame when the run is already finished.
- `GET /api/review/runs/<id>` (or a `createServerFn` like
  `reports.functions.ts:11`): return the `RunSnapshot` for a page that only wants
  status/summary (e.g. reconnecting after completion).
- Keep every engine/config import server-only, as today.

> Note: no GET handlers or `validateSearch` exist in the app yet (all API routes
> are POST), so this introduces the first ones — confirm the TanStack Start
> `server.handlers.GET` signature and query parsing during implementation.

### 1d. In-memory fast path + disk cold path

- While a run is live, subscribers read from the in-memory `LiveRun` (no disk
  I/O per frame).
- After a restart (or for a run not in `active`), `subscribe`/`getSnapshot` load
  `events.jsonl` + `summary.json` from disk. If the manifest says `running` but no
  live run exists (process died mid-run), surface a terminal `error` frame
  ("run interrupted by server restart") — do **not** silently restart AI work.

---

## Part 2 — Client: URL-driven run id and rehydration (`apps/web/src`)

### 2a. Route search params

- `apps/web/src/routes/review.tsx`: add `validateSearch` for `run?: string`:
  ```ts
  export const Route = createFileRoute("/review")({
    validateSearch: (search: Record<string, unknown>): { run?: string } => ({
      run: typeof search.run === "string" ? search.run : undefined,
    }),
    component: ReviewPage,
  });
  ```
- Mirror on `pbi.tsx` and `project.tsx` (`kind` selects the endpoint).
- Changing a runner's result to the same PR/strategy should update `?run=` via
  `navigate({ search })` (or `history.replaceState`), so the current run is always
  bookmarkable/refreshable.

### 2b. Extend `useReviewStream` (`apps/web/src/components/review/useReviewStream.ts`)

Rework the hook so a run is identified by `runId` and driven by the GET stream:

```ts
useReviewStream<TResult>({ endpoint, kind, runId?, onRunCreated })
```

- `run(input)`:
  1. `const { runId } = await fetch(endpoint, { method: "POST", ... })`.
  2. Call `onRunCreated(runId)` so the runner writes `?run=<id>` to the URL.
  3. `attach(runId)` — open `GET ${endpoint}?run=${runId}`, read SSE frames, and
     reduce them through the existing `handleEvent`/`applyPhase`/`applyStep` code.
- `attach(runId)` is also called on **mount when `runId` is present** in search
  params. Track `lastSeq` in a ref; pass `&from=lastSeq` so a mid-stream reconnect
  does not duplicate already-rendered frames. Reuse the fetch/SSE frame parser at
  `useReviewStream.ts:275-291`.
- Deduplicate by `seq` rather than reconstructing from scratch, so reconnect is
  idempotent. The reducer must tolerate replaying the backlog from `seq = 0`
  (current `run()` resets all state first — keep that behavior on a fresh
  attach and only skip when a partial `from` is supplied).
- `stop()` should **detach** (abort the local fetch) rather than imply the run is
  cancelled. Add an explicit `cancelRun(runId)` control (POST
  `/api/review/runs/<id>/cancel`) if we want true cancellation; otherwise document
  that "Stop" only stops _watching_.

### 2c. Runner wiring

- `ReviewRunner.tsx:47`: read `const { run } = Route.useSearch()` (or accept it as
  a prop from the page), pass it into the hook, and pass `onRunCreated` that sets
  the search param.
- On mount with a `runId`, prefill the result/summary from the replayed `result`
  frame — no form resubmission needed.
- `lastInput` (`ReviewRunner.tsx:45`) can be reconstructed from the run manifest's
  `input` (returned by the snapshot endpoint), which also fixes `PostCommentsAction`
  after a resume.

---

## Part 3 — Retention, cleanup, and sharing

- Prune on server start and after each run completes: keep the newest N runs or
  runs younger than `MM_RUN_RETENTION_MS` (new env var, documented in
  `docs/configuration.md` and `.env.example`).
- The `/reports` page (`apps/web/src/routes/reports.tsx:52`) can link a report to
  its originating run: store `reportName` in the manifest and render a "View run"
  link, or make `/reports` selection URL-driven with `?run=`/`?report=` too.
- Because run ids are unguessable, sharing a `/review?run=<id>` link reproduces the
  run locally as long as the run directory still exists. For multi-user/exposed
  deployments, gate the run endpoints behind auth — note this explicitly; the
  current app assumes a local, single-user host.

---

## Part 4 — Edge cases to handle

- **Refresh during an active run**: GET replays backlog, then follows live; run
  keeps executing because it is registry-owned.
- **Refresh after completion**: manifest `done` + `summary.json` replays the full
  result and closes the stream.
- **Double-submit / two tabs**: `startOrAttach` returns the same `runId` for an
  active target; both tabs subscribe and see the same frames.
- **Server restart mid-run**: manifest is `running` but no live run — emit a
  terminal error frame; do not auto-restart costly AI work.
- **Aborted POST before runId returned**: create the manifest _before_ returning,
  so a run is never orphaned without an id.
- **Unknown/expired run id in URL**: `GET` returns 404; the client clears `?run=`
  and shows an empty form with a note.
- **Write mode / posted comments**: persisted `input` lets `PostCommentsAction`
  and the post-comments endpoint replay without re-resolving from scratch.

---

## Part 5 — Testing & verification

- Unit-test `reviewRunStore.server.ts` (append/read/prune, atomic writes) and
  `reviewRuns.server.ts` (start-or-attach dedupe, replay ordering, restart
  recovery) under `apps/web` — confirm whether a Vitest config/test harness exists
  there; the polish plan (`ideas/web-ui-polish-plan.md:140`) notes it may not.
- Test the hook reducer against a replayed event sequence (idempotency by `seq`).
- Manual: start a long `multi-agent` review, refresh mid-run, confirm the timeline
  and live output resume; refresh after completion and confirm the result card
  renders; open the same URL in a second tab.
- Run `pnpm typecheck && pnpm lint && pnpm test` (and `pnpm build`).

---

## Sequencing & risk

1. **Run registry + store** (Part 1a/1b) — the core; decouple execution from the
   response. Highest risk, touches the SSE path.
2. **Routes** (Part 1c) — create/attach/snapshot endpoints; first GET handlers.
3. **Client** (Part 2) — search param + rehydration in `useReviewStream`.
4. **Retention / reports link** (Part 3) and **edge cases** (Part 4).
5. **Tests** (Part 5).

**Main risk:** moving `engine.reviewPR` out of the request scope changes error
propagation and lifetime. Keep `execute` a direct refactor of
`createReviewStream`'s body and add the registry layer around it; don't touch the
engines in `libs/core`. Also verify Node/undici behavior when an SSE client
disconnects — the registry must not treat subscriber loss as cancellation.

## Decisions to confirm

- **Scope:** PR, PBI, and project runners all get resume, sharing one registry.
- **Start protocol:** POST creates and returns `runId`; streaming is always a
  separate GET. (Alternative: keep POST SSE and only add GET for resume — less
  disruptive but leaves the run tied to the POST connection.)
- **Ownership:** server-side registry with durable `.mergementor/runs/` history;
  runs survive refresh and process restart.
- **Duplicates:** an active run for the same target is reused, not restarted.
- **"Stop" semantics:** detach by default; explicit cancel endpoint is a follow-up.
