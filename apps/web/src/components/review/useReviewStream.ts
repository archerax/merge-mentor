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
}

/** Hook result: stream state plus controls. */
interface UseReviewStreamResult<TResult> extends ReviewStreamState<TResult> {
  readonly running: boolean;
  run(input: unknown): Promise<void>;
  stop(): void;
}

type PhaseEvent = Extract<ReviewProgressEvent, { kind: "phase" }>;
type StepEvent = Extract<ReviewProgressEvent, { kind: "step" }>;

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

/**
 * Owns the fetch/SSE plumbing for a review endpoint and reduces the frame
 * stream into a structured UI model.
 *
 * This replaces the duplicated run logic that previously lived inline in both
 * runner components: connection lifecycle, abort handling, raw technical log
 * accumulation, progress timeline, and per-phase AI output.
 */
export function useReviewStream<TResult = ReviewSummary>(
  endpoint: string
): UseReviewStreamResult<TResult> {
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

  const nextEntryId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const startRef = useRef<number | null>(null);

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

  const run = useCallback(
    async (input: unknown) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      nextEntryId.current = 0;
      startRef.current = Date.now();
      setStartedAt(startRef.current);
      setElapsedMs(0);
      setStatus("running");
      setPhases([]);
      setSteps([]);
      setActivity(null);
      setLive(null);
      setEntries([]);
      setSummary(null);
      setError(null);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Review request failed (HTTP ${response.status}).`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
            if (!dataLine) continue;
            handleEvent(JSON.parse(dataLine.slice(6)) as ReviewStreamEvent<TResult>);
          }
        }

        setStatus((current) => (current === "error" ? current : "done"));
      } catch (caught) {
        if (isAbortError(caught)) {
          setStatus("idle");
          return;
        }
        setError(caught instanceof Error ? caught.message : String(caught));
        setStatus("error");
      }
    },
    [endpoint, handleEvent]
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
    running: status === "running",
    run,
    stop,
  };
}
