import { createFileRoute } from "@tanstack/react-router";

import { handlePrdUpload } from "../../../server/prdReview.server.js";
import { createRunStreamResponse } from "../../../server/runStream.server.js";

/**
 * Server routes for running and following a PRD / FRD review.
 *
 * `POST` takes the raw `.docx` bytes (`application/octet-stream`, options in
 * `x-mm-*` headers), validates them and returns `{ runId }`; `GET ?run=<id>`
 * streams the run's frames as Server-Sent Events. Both handlers are server-only.
 */
export const Route = createFileRoute("/api/prd/stream")({
  server: {
    handlers: {
      POST: ({ request }) => handlePrdUpload(request),
      GET: ({ request }) => createRunStreamResponse(request),
    },
  },
});
