import { createFileRoute } from "@tanstack/react-router";

import type { PBIReviewStreamInput } from "../../../server/review.types.js";
import { createRunStreamResponse } from "../../../server/runStream.server.js";
import { startPBIReview } from "../../../server/workItemReview.server.js";

/**
 * Server routes for running and following a PBI review.
 *
 * `POST` creates (or attaches to) a run and returns `{ runId }`; `GET ?run=<id>`
 * streams the run's frames as Server-Sent Events. Both handlers are server-only.
 */
export const Route = createFileRoute("/api/pbi/stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let input: PBIReviewStreamInput;
        try {
          input = (await request.json()) as PBIReviewStreamInput;
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }

        try {
          return Response.json(startPBIReview(input));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.json({ error: message }, { status: 400 });
        }
      },
      GET: ({ request }) => createRunStreamResponse(request),
    },
  },
});
