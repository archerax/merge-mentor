import type { ReviewPhaseId, ReviewProgressEvent } from "@merge-mentor/core/review/progress.js";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ReviewStreamEvent, ReviewSummary } from "../../server/review.types.js";

/** High-level lifecycle of a streamed review run. */
type ReviewStatus = "idle" | "running" | "done" | "error";

/** Lifecycle status shared by phases and steps in the UI model. */
type ProgressStatusView = "start" | "done" | "error";

/** A coarse pipeline phase rendered in the progress timeline. */
export interface ProgressPhaseView {
  readonly id: ReviewPhaseId;
  readonly label: string;
  readonly status: ProgressStatusView;
  readonly startedAt: number;
  readonly endedAt?: number;
}

/** A finer-grained unit of work (e.g. one multi-agent subagent). */
export interface ProgressStepView {
  readonly id: string;
  readonly label: string;
  readonly status: ProgressStatusView;
  readonly detail?: string;
  readonly startedAt: number;
  readonly endedAt?: number;
}

/** A single raw status/log/chunk entry for the technical log. */
export interface TechnicalEntry {
  readonly id: number;
  readonly kind: "status" | "log" | "chunk";
  readonly text: string;
}

/** Accumulated formatted AI output for the phase currently streaming. */
export interface LiveOutput {
  readonly phase: ReviewPhaseId;
  readonly text: string;
}

/** Options accepted by {@link useReviewStream}. */
export interface UseReviewStreamOptions {
  /** Server-sent events endpoint that creates and streams the review. */
  readonly endpoint: string;
  /** Run id from the URL, re-attached on mount to resume a run. */
  readonly runId?: string;
  /** Called with the new run id so the caller can persist it in the URL. */
  readonly onRunCreated?: (runId: string) => void;
}

/** Full observable state of a streamed review run. */
interface ReviewStreamState<TResult> {
  readonly status: ReviewStatus;
  readonly phases: readonly ProgressPhaseView[];
  readonly steps: readonly ProgressStepView[];
  readonly activity: string | null;
  readonly live: LiveOutput | null;
  readonly entries: readonly TechnicalEntry[];
  readonly summary: TResult | null;
  readonly error: string | null;
  readonly startedAt: number | null;
  readonly elapsedMs: number;
  /** Original input of the current run, recovered from the manifest on resume. */
  readonly runInput: unknown | null;
}

/** Hook result: stream state plus controls. */
interface UseReviewStreamResult<TResult> extends ReviewStreamState<TResult> {
  readonly running: boolean;
  run(input: unknown): Promise<void>;
  stop(): void;
}

type PhaseEvent = Extract<ReviewProgressEvent, { kind: "phase" }>;
type StepEvent = Extract<ReviewProgressEvent, { kind: "step" }>;

/** Maximum number of reconnects before surfacing a connection error. */
const MAX_ATTACH_ATTEMPTS = 5;

/** Base delay between reconnect attempts, multiplied by the attempt number. */
const RECONNECT_BASE_DELAY_MS = 500;

/** Returns true when a thrown value is a fetch abort. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Folds a phase event into the phase list, closing any other active phase. */
function applyPhase(
  previous: readonly ProgressPhaseView[],
  event: PhaseEvent
): ProgressPhaseView[] {
  const now = Date.now();
  const existing = previous.findIndex((phase) => phase.id === event.id);

  if (event.status === "start") {
    const closed = previous.map((phase) =>
      phase.status === "start" && phase.id !== event.id
        ? { ...phase, status: "done" as const, endedAt: now }
        : phase
    );
    const started: ProgressPhaseView = {
      id: event.id,
      label: event.label,
      status: "start",
      startedAt: now,
    };
    if (existing >= 0) {
      return closed.map((phase) => (phase.id === event.id ? started : phase));
    }
    return [...closed, started];
  }

  if (existing >= 0) {
    return previous.map((phase, index) =>
      index === existing
        ? { ...phase, label: event.label, status: event.status, endedAt: now }
        : phase
    );
  }

  return [
    ...previous,
    {
      id: event.id,
      label: event.label,
      status: event.status,
      startedAt: now,
      endedAt: now,
    },
  ];
}

/** Folds a step event into the step list, matching an in-flight start. */
function applyStep(previous: readonly ProgressStepView[], event: StepEvent): ProgressStepView[] {
  const now = Date.now();

  if (event.status === "start") {
    return [...previous, { id: event.label, label: event.label, status: "start", startedAt: now }];
  }

  const existing = previous.findIndex((step) => step.id === event.label && step.status === "start");
  if (existing >= 0) {
    return previous.map((step, index) =>
      index === existing
        ? { ...step, status: event.status, detail: event.detail, endedAt: now }
        : step
    );
  }

  return [
    ...previous,
    {
      id: event.label,
      label: event.label,
      status: event.status,
      detail: event.detail,
      startedAt: now,
      endedAt: now,
    },
  ];
}

/** Parses one SSE frame, returning its sequence id (when present) and data. */
function parseFrame(frame: string): { seq: number | null; data: string | null } {
  let seq: number | null = null;
  let data: string | null = null;

  for (const line of frame.split("\n")) {
    if (line.startsWith("id: ")) {
      const parsed = Number.parseInt(line.slice(4), 10);
      if (Number.isFinite(parsed)) seq = parsed;
    } else if (line.startsWith("data: ")) {
      data = line.slice(6);
    }
  }

  return { seq, data };
}

/** Resolves after `ms`, or rejects with an abort error if `signal` fires first. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Owns the create/attach/stream plumbing for a review endpoint and reduces the
 * frame stream into a structured UI model.
 *
 * `run(input)` POSTs to create a run, reports the new run id via `onRunCreated`,
 * then attaches to its GET stream. When a `runId` is supplied (e.g. from the
 * URL) the hook attaches on mount, replaying the persisted backlog so a refresh
 * resumes an in-progress or finished run. Frames are de-duplicated by sequence
 * number, making reconnects idempotent.
 */
export function useReviewStream<TResult = ReviewSummary>(
  options: UseReviewStreamOptions
): UseReviewStreamResult<TResult> {
  const { endpoint, runId, onRunCreated } = options;

  const [status, setStatus] = useState<ReviewStatus>("idle");
  const [phases, setPhases] = useState<readonly ProgressPhaseView[]>([]);
  const [steps, setSteps] = useState<readonly ProgressStepView[]>([]);
  const [activity, setActivity] = useState<string | null>(null);
  const [live, setLive] = useState<LiveOutput | null>(null);
  const [entries, setEntries] = useState<readonly TechnicalEntry[]>([]);
  const [summary, setSummary] = useState<TResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [runInput, setRunInput] = useState<unknown | null>(null);

  const nextEntryId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const startRef = useRef<number | null>(null);
  const attachedRunRef = useRef<string | null>(null);
  const lastSeqRef = useRef(0);
  const onRunCreatedRef = useRef(onRunCreated);

  useEffect(() => {
    onRunCreatedRef.current = onRunCreated;
  }, [onRunCreated]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (status !== "running") return;
    const started = startRef.current ?? Date.now();
    const tick = (): void => setElapsedMs(Date.now() - started);
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [status]);

  const append = useCallback((kind: TechnicalEntry["kind"], text: string) => {
    setEntries((previous) => [...previous, { id: nextEntryId.current++, kind, text }]);
  }, []);

  const handleProgress = useCallback((event: ReviewProgressEvent) => {
    switch (event.kind) {
      case "phase":
        setPhases((previous) => applyPhase(previous, event));
        if (event.status !== "start") setActivity(null);
        break;
      case "step":
        setSteps((previous) => applyStep(previous, event));
        break;
      case "activity":
        setActivity(event.label);
        break;
      case "stream":
        setLive((previous) =>
          previous && previous.phase === event.phase
            ? { phase: event.phase, text: previous.text + event.delta }
            : { phase: event.phase, text: event.delta }
        );
        break;
    }
  }, []);

  const handleEvent = useCallback(
    (event: ReviewStreamEvent<TResult>) => {
      switch (event.type) {
        case "status":
          append("status", `\n▸ ${event.message}\n`);
          break;
        case "log":
          append("log", `${event.message}\n`);
          break;
        case "chunk":
          append("chunk", event.text);
          break;
        case "progress":
          handleProgress(event.event);
          break;
        case "stream":
          handleProgress({ kind: "stream", phase: event.phase, delta: event.delta });
          break;
        case "result":
          setSummary(event.summary);
          break;
        case "error":
          setError(event.message);
          setStatus("error");
          break;
        case "done":
          break;
      }
    },
    [append, handleProgress]
  );

  const resetState = useCallback(() => {
    nextEntryId.current = 0;
    lastSeqRef.current = 0;
    startRef.current = Date.now();
    setStartedAt(startRef.current);
    setElapsedMs(0);
    setPhases([]);
    setSteps([]);
    setActivity(null);
    setLive(null);
    setEntries([]);
    setSummary(null);
    setError(null);
  }, []);

  /** Reads an SSE body, dispatching de-duplicated frames to `handleEvent`. */
  const readStream = useCallback(
    async (body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> => {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const { seq, data } = parseFrame(frame);
            if (!data) continue;
            if (seq !== null) {
              if (seq <= lastSeqRef.current) continue;
              lastSeqRef.current = seq;
            }
            handleEvent(JSON.parse(data) as ReviewStreamEvent<TResult>);
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (!signal.aborted) {
        setStatus((current) => (current === "error" ? current : "done"));
      }
    },
    [handleEvent]
  );

  /**
   * Attaches to an existing run, replaying from the last seen sequence number.
   * Reconnects with backoff if the stream drops before the terminal frame.
   */
  const attach = useCallback(
    async (id: string, attachOptions: { readonly reset: boolean }): Promise<void> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      attachedRunRef.current = id;

      if (attachOptions.reset) resetState();
      setStatus("running");

      let attempt = 0;
      for (;;) {
        try {
          const url = `${endpoint}?run=${encodeURIComponent(id)}&from=${lastSeqRef.current}`;
          const response = await fetch(url, {
            headers: { Accept: "text/event-stream" },
            signal: controller.signal,
          });

          if (response.status === 404) {
            setError("This review run could not be found. It may have been cleaned up.");
            setStatus("error");
            return;
          }
          if (!response.ok || !response.body) {
            throw new Error(`Review stream failed (HTTP ${response.status}).`);
          }

          await readStream(response.body, controller.signal);
          return;
        } catch (caught) {
          if (isAbortError(caught)) {
            setStatus("idle");
            return;
          }
          attempt += 1;
          if (attempt >= MAX_ATTACH_ATTEMPTS) {
            setError(caught instanceof Error ? caught.message : String(caught));
            setStatus("error");
            return;
          }
          try {
            await delay(RECONNECT_BASE_DELAY_MS * attempt, controller.signal);
          } catch (delayError) {
            // The signal aborted while waiting to reconnect; stop quietly.
            if (isAbortError(delayError)) {
              setStatus("idle");
              return;
            }
            throw delayError;
          }
        }
      }
    },
    [endpoint, readStream, resetState]
  );

  /** Recovers the original input from a run manifest, for post-comments on resume. */
  const recoverInput = useCallback(async (id: string): Promise<void> => {
    try {
      const response = await fetch(`/api/review/runs/${encodeURIComponent(id)}`);
      if (!response.ok) return;
      const snapshot = (await response.json()) as { manifest?: { input?: unknown } };
      setRunInput(snapshot.manifest?.input ?? null);
    } catch {
      // Resume still works without the input; only post-comments need it.
    }
  }, []);

  // Resume on mount when the URL carries a run id.
  useEffect(() => {
    if (!runId || attachedRunRef.current === runId) return;
    void (async () => {
      await recoverInput(runId);
      await attach(runId, { reset: true });
    })().catch(() => {
      // `attach` reports its own failures through state; nothing to surface here.
    });
  }, [runId, recoverInput, attach]);

  const run = useCallback(
    async (input: unknown) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setRunInput(input);
      resetState();
      setStatus("running");

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: controller.signal,
        });

        if (!response.ok) {
          let message = `Review request failed (HTTP ${response.status}).`;
          try {
            const data = (await response.json()) as { error?: unknown };
            if (typeof data.error === "string") message = data.error;
          } catch {
            // Keep the status-based message.
          }
          throw new Error(message);
        }

        const data = (await response.json()) as { runId?: unknown };
        if (typeof data.runId !== "string") {
          throw new Error("Review request did not return a run id.");
        }

        onRunCreatedRef.current?.(data.runId);
        await attach(data.runId, { reset: false });
      } catch (caught) {
        if (isAbortError(caught)) {
          setStatus("idle");
          return;
        }
        setError(caught instanceof Error ? caught.message : String(caught));
        setStatus("error");
      }
    },
    [endpoint, attach, resetState]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
  }, []);

  return {
    status,
    phases,
    steps,
    activity,
    live,
    entries,
    summary,
    error,
    startedAt,
    elapsedMs,
    runInput,
    running: status === "running",
    run,
    stop,
  };
}
