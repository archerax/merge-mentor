import { createFileRoute } from "@tanstack/react-router";

import { postComments } from "../../../server/postComments.server.js";

/**
 * Server route that posts the comments a dry-run review planned.
 *
 * The planned payload is supplied by the client (round-tripped from the review
 * summary); no AI work is re-run. The handler is server-only and returns the
 * per-comment outcome as JSON.
 */
export const Route = createFileRoute("/api/review/post")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let data: unknown;
        try {
          data = await request.json();
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }

        try {
          const result = await postComments(data);
          return Response.json(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});
