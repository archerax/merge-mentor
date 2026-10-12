import { createFileRoute } from "@tanstack/react-router";

import { getSnapshot } from "../../../../server/reviewRuns.server.js";

/**
 * Server route that returns a run's status and summary without streaming.
 *
 * The client uses it on resume to recover the original input (for
 * post-comments) and, if needed, the final summary. Returns 404 for an unknown
 * run so the client can clear a stale `?run=` param.
 */
export const Route = createFileRoute("/api/review/runs/$runId")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const snapshot = getSnapshot(params.runId);
        if (!snapshot) return new Response("Unknown run", { status: 404 });
        return Response.json(snapshot);
      },
    },
  },
});
