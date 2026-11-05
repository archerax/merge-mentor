import { createFileRoute } from "@tanstack/react-router";

import { handlePrdBreakdownStart } from "../../../server/prdBreakdown.server.js";
import { createRunStreamResponse } from "../../../server/runStream.server.js";

/**
 * Server routes for running and following a PRD / FRD work breakdown.
 *
 * `POST` takes `{ prdRunId, force? }` (JSON), validates it and returns
 * `{ runId }`; `GET ?run=<id>` streams the run's frames as Server-Sent Events.
 * Both handlers are server-only.
 */
export const Route = createFileRoute("/api/prd/breakdown")({
  server: {
    handlers: {
      POST: ({ request }) => handlePrdBreakdownStart(request),
      GET: ({ request }) => createRunStreamResponse(request),
    },
  },
});
