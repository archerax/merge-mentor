import type { ReviewStreamEvent } from "../server/review.types.js";

/** Formats events as SSE frames, numbering them from `startSeq`. */
export function sseFrames(events: readonly ReviewStreamEvent<unknown>[], startSeq = 1): string {
  return events
    .map((event, index) => `id: ${startSeq + index}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

/** A streaming `text/event-stream` response whose body is delivered in `chunks`. */
export function sseResponse(
  chunks: readonly string[],
  init: ResponseInit = { status: 200 }
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, init);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
