/**
 * Shared Server-Sent Events plumbing for the interactive review endpoints.
 *
 * All review kinds stream the same frame shape (see `ReviewStreamEvent`): status
 * and log lines, batched raw output chunks, a terminal result or error, then a
 * closing `done` frame. This helper centralizes the buffering, ANSI stripping,
 * and flush scheduling so each endpoint only supplies its run logic.
 */

import type { ReviewPhaseId } from "@merge-mentor/core/review/progress.js";

/** Matches ANSI escape sequences emitted by the terminal streaming display. */
// oxlint-disable-next-line no-control-regex -- the ESC control character is the point.
const ANSI_ESCAPE = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;

/** Milliseconds to batch streamed chunks before flushing them to the client. */
const CHUNK_FLUSH_INTERVAL_MS = 80;

/** Phase id attached to a streamed delta frame. */
type StreamPhase = ReviewPhaseId;

/** Emitter handed to a review run so it can push frames and raw chunks. */
export interface SseEmitter {
  /** Sends a single JSON-encoded event frame. */
  send(event: unknown): void;
  /** Queues raw output, flushed on a short interval. */
  pushChunk(chunk: string): void;
  /** Queues formatted AI output for a phase, flushed on a short interval. */
  pushStream(phase: StreamPhase, delta: string): void;
  /** Flushes any batched chunk/stream output immediately. */
  flush(): void;
}

/** Headers required for a Server-Sent Events response. */
export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

/**
 * Creates an emitter that forwards frames to `sink`, batching raw chunks and
 * formatted phase output on a short interval and stripping ANSI escapes.
 *
 * The batching is transport-independent: the run registry uses it with a
 * persistent-event sink, so a live subscriber and a durable replay see the
 * exact same frames.
 */
export function createEmitter(sink: (event: unknown) => void): SseEmitter {
  let pendingChunks = "";
  let pendingStream = "";
  let pendingStreamPhase: StreamPhase | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushChunks = (): void => {
    if (pendingChunks.length === 0) return;
    sink({ type: "chunk", text: pendingChunks });
    pendingChunks = "";
  };

  const flushStream = (): void => {
    if (pendingStream.length === 0 || pendingStreamPhase === null) return;
    sink({ type: "stream", phase: pendingStreamPhase, delta: pendingStream });
    pendingStream = "";
  };

  const flush = (): void => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushChunks();
    flushStream();
  };

  const schedule = (): void => {
    if (flushTimer === null) {
      flushTimer = setTimeout(flush, CHUNK_FLUSH_INTERVAL_MS);
    }
  };

  const pushChunk = (chunk: string): void => {
    pendingChunks += chunk.replace(ANSI_ESCAPE, "");
    schedule();
  };

  const pushStream = (phase: StreamPhase, delta: string): void => {
    // Phase changes are rare; flush the current buffer so a frame never mixes
    // deltas from two phases.
    if (pendingStream.length > 0 && pendingStreamPhase !== phase) {
      flushStream();
    }
    pendingStreamPhase = phase;
    pendingStream += delta.replace(ANSI_ESCAPE, "");
    schedule();
  };

  return { send: sink, pushChunk, pushStream, flush };
}
