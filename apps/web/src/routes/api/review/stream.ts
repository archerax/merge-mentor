import { createFileRoute } from "@tanstack/react-router";

import { createReviewStream } from "../../../server/review.server.js";
import type { ReviewStreamInput } from "../../../server/review.types.js";

/**
 * Server route that runs a PR review and streams raw output as Server-Sent Events.
 *
 * The handler is server-only; `createReviewStream` never reaches the client
 * bundle. Consumed by the `/review` route via `fetch`.
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

        return new Response(createReviewStream(input), {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
