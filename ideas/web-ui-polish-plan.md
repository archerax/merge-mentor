# Web UI Polish Plan

Turn the runner pages into a polished product instead of a console-output dump.

## Problem

The three runner pages (`/review`, `/pbi`, `/project`) stream three raw event types
and render them verbatim into a monospace `<Code>` block:

- `apps/web/src/components/ReviewRunner.tsx:228` and
  `WorkItemReviewRunner.tsx:265` render every `status`/`log`/`chunk` frame as
  pre-wrapped code.
- `chunk` frames are **raw AI token deltas** (`libs/core/src/review/engine.ts:427`,
  provider `onStreamData`) — partial markdown/JSON mid-stream.
- `log` frames are **verbatim CLI strings**: emoji prefixes, `"".repeat(60)`
  separator bars, file lists, and even full dry-run comment bodies
  (`engine.ts:1717-1738`, `projectEngine.ts:529-566`, `pbiEngine.ts:240-253`).
- There is no structured progress model — `review.types.ts:118` only has
  `status|log|chunk|result|error|done`. The home/review copy literally advertises
  "watch raw output stream in live" (`routes/index.tsx:42`, `routes/review.tsx:18`).

The structured `ReviewResult` card that appears at the end is good — the problem
is the always-on terminal panel above it and the lack of a real progress/phase
model.

## Design

Replace the single monospace code block with a **structured progress timeline +
phase-scoped formatted AI output + collapsed technical log**, and make the engines
emit real progress events instead of relying on console strings.

The runner logic is duplicated between `ReviewRunner.tsx` and
`WorkItemReviewRunner.tsx`, so extract a shared hook and components first.

---

## Part 1 — Structured progress protocol (`libs/shared`, `libs/core`)

### 1a. Define the event model

New file, e.g. `libs/core/src/review/progress.ts`:

```ts
export type ReviewPhaseId =
  "resolve" | "fetch" | "workspace" | "file-review" | "cross-file" | "verify" | "post" | "report";

export type ReviewProgressEvent =
  | { kind: "phase"; id: ReviewPhaseId; label: string; status: "start" | "done" | "error" }
  | { kind: "step"; label: string; status: "start" | "done" | "error"; detail?: string }
  | { kind: "activity"; label: string }
  | { kind: "stream"; phase: ReviewPhaseId; delta: string }; // phase-tagged AI tokens
```

### 1b. Add `onProgress?: (event: ReviewProgressEvent) => void` to engine options

- `ReviewEngine` options (`libs/core/src/review/engine.ts:194`)
- `PBIReviewEngine` (`pbiEngine.ts:42`), `ProjectReviewEngine` (`projectEngine.ts:94`)
- `MultiAgentOrchestrator` for per-subagent steps (`orchestrator.ts:511-523`)

Keep `onStreamChunk` as-is for the raw technical log (backward compatible; CLI and
existing tests untouched).

### 1c. Instrument the pipelines

Wrap existing `this.log(...)` call sites at phase boundaries:

- PR `runReviewPipeline` (`engine.ts:660`):
  `resolve → fetch → workspace → file-review → cross-file → verify → post → report`.
- Fast path (`engine.ts:725`) and multi-agent path (`engine.ts:740`): phase +
  subagent steps.
- PBI (`pbiEngine.ts:64`) and project (`projectEngine.ts`) flows:
  `resolve → fetch → AI review → report → post`.
- Tag each `onStreamChunk`/`onStreamData` invocation with the active phase so the
  UI can render markdown per phase.

CLI behavior is unchanged because it never passes `onProgress`.

---

## Part 2 — Web server wiring (`apps/web/src/server`)

- Extend `ReviewStreamEvent` (`review.types.ts:118`) with `progress` and `stream`
  frame types.
- Add a batched, ANSI-stripped `stream` channel to `SseEmitter` (`sse.server.ts`)
  mirroring `pushChunk`.
- In `review.server.ts` and `workItemReview.server.ts`, pass `onProgress` that
  forwards events; route `stream` deltas to the formatted panel and keep
  `log`/`chunk` feeding the technical log.
- No change to `resolveTarget`/engine construction other than adding the callback.

---

## Part 3 — Runner UI redesign (`apps/web/src/components`)

### Extract shared pieces

- `useReviewStream(endpoint)` hook — owns the fetch/SSE parsing, status, abort, and
  event routing (removes the current duplication).
- `ProgressTimeline` — Mantine `Timeline`/`Stepper` driven by `progress` events:
  phases with start/done/error, active activity line, elapsed timer, per-subagent
  steps.
- `LiveThinking` — accumulates the active phase's `stream` deltas and renders them
  with the existing `MarkdownReport` (`react-markdown`) inside a styled card;
  resets/collapses when the phase completes.
- `TechnicalLog` — the raw `log`/`chunk` stream in a collapsed `<Accordion>` with a
  copy button; auto-scroll only while expanded.

### Runner layout

- While running: `ProgressTimeline` + `LiveThinking` only.
- On completion: auto-collapse live panels, render the existing `ReviewResult` /
  `PBIReviewResult` / `ProjectReviewResult` as the primary card.
- Move the `Accordion` "Technical log" below the result.

---

## Part 4 — Result polish (small, same components)

- Severity summary bar and finding count chips at the top of the result card.
- Finding filters (severity/category) and a copy-report button.
- Optional follow-up "post comments" action after a dry-run (currently write-mode
  is fixed before the run) — defer unless desired.

---

## Part 5 — Verification

- Add/extend unit tests: `onProgress` emissions in `engine.spec.ts`,
  `pbiEngine.spec.ts`, `projectEngine.spec.ts`; hook/component tests under
  `apps/web` (no test harness exists there yet — add vitest config only if UI tests
  are wanted).
- Run `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.

---

## Sequencing & risk

1. Part 1 (protocol + engine instrumentation) — largest, touches core + its tests.
   Clean and CLI-safe.
2. Part 2 (server wiring) — small, depends on 1.
3. Part 3 (UI) — the visible payoff; depends on 2.
4. Parts 4–5 — polish + tests.

**Main risk:** instrumenting every `this.log` call is broad. Scope it to phase
boundaries + notable steps rather than every line, keeping the raw technical log
for full detail. Confirm the phase list against the actual pipeline during
implementation.

## Decisions already made

- Scope: runner pages only (`/review`, `/pbi`, `/project`) plus shared components.
- Progress source: emit structured events from `libs/core` engines.
- Raw output: keep it, collapsed under a "Technical log".
- AI stream rendering: render as formatted markdown per phase.
