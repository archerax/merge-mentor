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
  /** Queues raw output, flushed to the client on a short interval. */
  pushChunk(chunk: string): void;
  /** Queues formatted AI output for a phase, flushed on a short interval. */
  pushStream(phase: StreamPhase, delta: string): void;
}

/** Extracts a human-readable message from an unknown thrown value. */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs `run`, streaming its frames as Server-Sent Events.
 *
 * Any error thrown by `run` is emitted as an `error` frame, and a final flush
 * plus stream close always happens.
 */
export function createSseResponse(
  run: (emit: SseEmitter) => Promise<void>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller): Promise<void> {
      let closed = false;
      let pendingChunks = "";
      let pendingStream = "";
      let pendingStreamPhase: StreamPhase | null = null;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const send = (event: unknown): void => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const flushChunks = (): void => {
        if (pendingChunks.length === 0) return;
        send({ type: "chunk", text: pendingChunks });
        pendingChunks = "";
      };

      const flushStream = (): void => {
        if (pendingStream.length === 0 || pendingStreamPhase === null) return;
        send({ type: "stream", phase: pendingStreamPhase, delta: pendingStream });
        pendingStream = "";
      };

      const flush = (): void => {
        flushTimer = null;
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
        // Phase changes are rare; flush the current buffer so a frame never
        // mixes deltas from two phases.
        if (pendingStream.length > 0 && pendingStreamPhase !== phase) {
          flushStream();
        }
        pendingStreamPhase = phase;
        pendingStream += delta.replace(ANSI_ESCAPE, "");
        schedule();
      };

      try {
        await run({ send, pushChunk, pushStream });
      } catch (error) {
        send({ type: "error", message: toMessage(error) });
      } finally {
        if (flushTimer !== null) clearTimeout(flushTimer);
        flush();
        closed = true;
        controller.close();
      }
    },
  });
}
