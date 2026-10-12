/**
 * Server-side registry that owns review run execution.
 *
 * A run is no longer tied to the HTTP connection that started it: `startOrAttach`
 * creates (or reuses) a run, kicks off execution, and appends every emitted frame
 * to a durable event log. Clients always render by *subscribing* to the GET
 * stream, which replays the persisted backlog and then follows live frames. A
 * refresh re-attaches from the URL; a finished run replays to completion from the
 * log without re-running any AI work.
 */

import { generateReviewRunId, isReviewRunId } from "@merge-mentor/shared/utils/reviewRunId.js";

import { resolveTempPath } from "./env.server.js";
import {
  appendEvent,
  closeEventLog,
  openEventLog,
  type ReviewRunKind,
  type ReviewRunManifest,
  type ReviewRunStatus,
  pruneRuns,
  readEvents,
  readManifest,
  readSummary,
  type StoredRunEvent,
  writeEvent,
  writeManifest,
  writeSummary,
} from "./reviewRunStore.server.js";
import { createEmitter, type SseEmitter } from "./sse.server.js";

/** Default age after which a completed run is pruned. */
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Default maximum number of retained runs. */
const DEFAULT_MAX_RUNS = 100;

/** How often a keep-alive comment is sent while waiting for the next frame. */
const HEARTBEAT_INTERVAL_MS = 15_000;

/** Callback invoked for each frame a subscriber should render. */
type RunSubscriber = (event: unknown, seq: number) => void;

/** A run currently executing in this process. */
interface LiveRun {
  readonly runId: string;
  readonly kind: ReviewRunKind;
  readonly targetKey: string;
  readonly input: unknown;
  readonly label: string;
  readonly createdAt: number;
  readonly subscribers: Set<RunSubscriber>;
  readonly events: StoredRunEvent[];
  emitter: SseEmitter;
  status: ReviewRunStatus;
  lastSeq: number;
  summary: unknown | null;
  /** Open event-log descriptor, if persistence was available at startup. */
  logFd: number | null;
}

/** A subscription handle returned by {@link subscribe}. */
export interface RunSubscription {
  /** Status of the run at subscription time. */
  readonly status: ReviewRunStatus;
  /** Detaches the subscriber. */
  readonly unsubscribe: () => void;
}

/** A point-in-time view of a run, without the event stream. */
export interface RunSnapshot {
  readonly manifest: ReviewRunManifest;
  readonly summary: unknown | null;
}

/** Spec passed to {@link startOrAttach} describing a run to execute. */
export interface StartRunOptions {
  /** Which review kind the run executes. */
  readonly kind: ReviewRunKind;
  /** Stable target key, used to dedupe concurrent runs of the same target. */
  readonly targetKey: string;
  /** Human-readable label shown in the UI. */
  readonly label: string;
  /** Original stream input, persisted for resume and post-comments. */
  readonly input: unknown;
  /** Runs the review, emitting frames through the supplied emitter. */
  readonly execute: (emitter: SseEmitter) => Promise<void>;
}

/** Runs executing in the current process, keyed by run id. */
const active = new Map<string, LiveRun>();

/** Run ids of in-flight runs, keyed by target key, for deduplication. */
const activeByTarget = new Map<string, string>();

/** Extracts a human-readable message from an unknown thrown value. */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Returns whether a frame is a final `result` frame carrying a summary. */
function isResultFrame(event: unknown): event is { type: "result"; summary: unknown } {
  return (
    typeof event === "object" && event !== null && (event as { type?: unknown }).type === "result"
  );
}

/** Returns whether a frame is the terminal `done` frame. */
function isDoneFrame(event: unknown): boolean {
  return (
    typeof event === "object" && event !== null && (event as { type?: unknown }).type === "done"
  );
}

/** Builds the persisted manifest for a live run. */
function toManifest(run: LiveRun): ReviewRunManifest {
  return {
    runId: run.runId,
    kind: run.kind,
    targetKey: run.targetKey,
    input: run.input,
    label: run.label,
    createdAt: run.createdAt,
    status: run.status,
  };
}

/**
 * Persists a frame, records it in memory for replay, and fans it out to live
 * subscribers. Persisting synchronously guarantees a subscriber can always
 * replay from disk after a process restart.
 */
function record(run: LiveRun, event: unknown): void {
  const seq = ++run.lastSeq;
  const entry: StoredRunEvent = { seq, event };
  run.events.push(entry);
  if (run.logFd !== null) writeEvent(run.logFd, entry);
  else appendEvent(resolveTempPath(), run.runId, entry);

  if (isResultFrame(event)) {
    run.summary = event.summary;
    writeSummary(resolveTempPath(), run.runId, event.summary);
  }

  for (const subscriber of run.subscribers) subscriber(event, seq);
}

/** Reads the retention policy from the environment, falling back to defaults. */
function retentionPolicy(): { readonly maxAgeMs: number; readonly maxCount: number } {
  const raw = process.env.MM_RUN_RETENTION_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  const maxAgeMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RETENTION_MS;
  return { maxAgeMs, maxCount: DEFAULT_MAX_RUNS };
}

/** Best-effort retention cleanup of old run directories. */
function pruneCompletedRuns(): void {
  try {
    // In-flight runs are protected: deleting a running run's directory would
    // erase its event-log history for clients that later reconnect/replay.
    pruneRuns(resolveTempPath(), { ...retentionPolicy(), protect: new Set(active.keys()) });
  } catch {
    // Retention is best-effort; never fail a run because cleanup failed.
  }
}

/** Runs a freshly created run and finalizes its manifest when it settles. */
async function execute(run: LiveRun, executor: StartRunOptions["execute"]): Promise<void> {
  try {
    await executor(run.emitter);
    run.status = "done";
  } catch (error) {
    run.emitter.send({ type: "error", message: toMessage(error) });
    run.status = "error";
  } finally {
    run.emitter.flush();
    run.emitter.send({ type: "done" });
    writeManifest(resolveTempPath(), toManifest(run));
    if (run.logFd !== null) {
      closeEventLog(run.logFd);
      run.logFd = null;
    }
    activeByTarget.delete(run.targetKey);
    active.delete(run.runId);
    run.subscribers.clear();
  }
}

/**
 * Creates a run for `options`, or attaches to an existing in-flight run for the
 * same target. Execution starts immediately and is not tied to any HTTP request.
 */
export function startOrAttach(options: StartRunOptions): { runId: string; attached: boolean } {
  pruneCompletedRuns();

  const existingId = activeByTarget.get(options.targetKey);
  if (existingId) {
    const existing = active.get(existingId);
    if (existing && existing.status === "running") {
      return { runId: existingId, attached: true };
    }
    activeByTarget.delete(options.targetKey);
  }

  const run: LiveRun = {
    runId: generateReviewRunId(options.targetKey),
    kind: options.kind,
    targetKey: options.targetKey,
    input: options.input,
    label: options.label,
    createdAt: Date.now(),
    subscribers: new Set(),
    events: [],
    emitter: undefined as unknown as SseEmitter,
    status: "running",
    lastSeq: 0,
    summary: null,
    logFd: null,
  };
  run.emitter = createEmitter((event) => record(run, event));

  active.set(run.runId, run);
  activeByTarget.set(options.targetKey, run.runId);
  writeManifest(resolveTempPath(), toManifest(run));
  run.logFd = openEventLog(resolveTempPath(), run.runId);

  void execute(run, options.execute);

  return { runId: run.runId, attached: false };
}

/**
 * Subscribes to a run's frames, replays the persisted backlog with `seq >
 * fromSeq`, then follows live frames. Returns `null` for an unknown run.
 *
 * If the manifest says `running` but no live run exists, the process died
 * mid-run: a terminal error frame is emitted rather than silently restarting
 * costly AI work.
 */
export function subscribe(
  runId: string,
  fromSeq: number,
  onEvent: RunSubscriber
): RunSubscription | null {
  const live = active.get(runId);
  if (live) {
    for (const entry of live.events) {
      if (entry.seq > fromSeq) onEvent(entry.event, entry.seq);
    }
    live.subscribers.add(onEvent);
    return { status: live.status, unsubscribe: () => live.subscribers.delete(onEvent) };
  }

  const manifest = readManifest(resolveTempPath(), runId);
  if (!manifest) return null;

  const events = readEvents(resolveTempPath(), runId, fromSeq);

  if (manifest.status === "running") {
    for (const entry of events) onEvent(entry.event, entry.seq);
    const lastSeq = events.length > 0 ? events[events.length - 1].seq : fromSeq;
    onEvent(
      { type: "error", message: "Review run was interrupted by a server restart." },
      lastSeq + 1
    );
    onEvent({ type: "done" }, lastSeq + 2);
    return { status: "error", unsubscribe: () => {} };
  }

  for (const entry of events) onEvent(entry.event, entry.seq);
  return { status: manifest.status, unsubscribe: () => {} };
}

/** Returns whether a run exists in memory or on disk. */
export function hasRun(runId: string): boolean {
  return (
    isReviewRunId(runId) && (active.has(runId) || readManifest(resolveTempPath(), runId) !== null)
  );
}

/** Returns a run's status and summary, or `null` when unknown. */
export function getSnapshot(runId: string): RunSnapshot | null {
  if (!isReviewRunId(runId)) return null;

  const live = active.get(runId);
  if (live) return { manifest: toManifest(live), summary: live.summary };

  const manifest = readManifest(resolveTempPath(), runId);
  if (!manifest) return null;
  return { manifest, summary: readSummary(resolveTempPath(), runId) };
}

/**
 * Streams a run as Server-Sent Events: replays persisted frames with `seq >
 * fromSeq`, follows live frames, then closes on the terminal `done` frame.
 *
 * Frames carry an SSE `id:` so a browser can reconnect with `Last-Event-ID`.
 * Returns `null` for an unknown run so the caller can respond with a 404.
 */
export function streamRun(runId: string, fromSeq: number): ReadableStream<Uint8Array> | null {
  if (!hasRun(runId)) return null;

  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  const close = (): void => {
    if (closed) return;
    closed = true;
    unsubscribe?.();
    if (heartbeat !== null) clearInterval(heartbeat);
    try {
      controller?.close();
    } catch {
      // The controller was already closed by the consumer.
    }
  };

  const onEvent: RunSubscriber = (event, seq) => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`));
    } catch {
      close();
      return;
    }
    if (isDoneFrame(event)) close();
  };

  return new ReadableStream<Uint8Array>({
    start(streamController): void {
      controller = streamController;

      const subscription = subscribe(runId, fromSeq, onEvent);
      if (!subscription) {
        close();
        return;
      }
      unsubscribe = subscription.unsubscribe;

      // A finished (or restart-interrupted) run may have replayed its terminal
      // frame synchronously during `subscribe`, already closing the stream.
      if (closed) return;

      if (subscription.status !== "running") {
        close();
        return;
      }

      heartbeat = setInterval(() => {
        if (closed || !controller) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          close();
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel(): void {
      close();
    },
  });
}
