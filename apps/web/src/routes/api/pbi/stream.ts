import { createFileRoute } from "@tanstack/react-router";

import type { PBIReviewStreamInput } from "../../../server/review.types.js";
import { createPBIReviewStream } from "../../../server/workItemReview.server.js";

/**
 * Server route that runs a PBI review and streams raw output as Server-Sent Events.
 *
 * The handler is server-only; `createPBIReviewStream` never reaches the client
 * bundle. Consumed by the `/pbi` route via `fetch`.
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

        return new Response(createPBIReviewStream(input), {
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
