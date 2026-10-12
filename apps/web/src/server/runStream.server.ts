/**
 * Shared handler for the GET side of the review stream endpoints.
 *
 * The client (or a browser reconnect) supplies `?run=<id>&from=<seq>`; this
 * resolves the run, replays its persisted backlog, and follows live frames. An
 * unknown run yields a 404 so the client can clear the stale `?run=` param.
 */

import { streamRun } from "./reviewRuns.server.js";
import { SSE_HEADERS } from "./sse.server.js";

/** Builds the SSE response that attaches to a run identified by query params. */
export function createRunStreamResponse(request: Request): Response {
  const url = new URL(request.url);
  const runId = url.searchParams.get("run");
  if (!runId) return new Response("Missing run id", { status: 400 });

  const requested = Number.parseInt(url.searchParams.get("from") ?? "0", 10);
  const fromSeq = Number.isFinite(requested) && requested > 0 ? requested : 0;

  const stream = streamRun(runId, fromSeq);
  if (!stream) return new Response("Unknown run", { status: 404 });

  return new Response(stream, { headers: SSE_HEADERS });
}
