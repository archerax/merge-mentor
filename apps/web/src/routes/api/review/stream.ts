import { createFileRoute } from "@tanstack/react-router";

import { startPRReview } from "../../../server/review.server.js";
import type { ReviewStreamInput } from "../../../server/review.types.js";
import { createRunStreamResponse } from "../../../server/runStream.server.js";

/**
 * Server routes for running and following a PR review.
 *
 * `POST` creates (or attaches to) a run and returns `{ runId }` immediately;
 * `GET ?run=<id>` streams the run's frames as Server-Sent Events, replaying the
 * persisted backlog then following live output. Execution is owned by the run
 * registry, so a refresh can re-attach. Both handlers are server-only.
 */
export const Route = createFileRoute("/api/review/stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let input: ReviewStreamInput;
        try {
          input = (await request.json()) as ReviewStreamInput;
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }

        try {
          return Response.json(startPRReview(input));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.json({ error: message }, { status: 400 });
        }
      },
      GET: ({ request }) => createRunStreamResponse(request),
    },
  },
});
