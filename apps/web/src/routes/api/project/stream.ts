import { createFileRoute } from "@tanstack/react-router";

import type { ProjectReviewStreamInput } from "../../../server/review.types.js";
import { createProjectReviewStream } from "../../../server/workItemReview.server.js";

/**
 * Server route that runs a project plan review and streams raw output as
 * Server-Sent Events.
 *
 * The handler is server-only; `createProjectReviewStream` never reaches the
 * client bundle. Consumed by the `/project` route via `fetch`.
 */
export const Route = createFileRoute("/api/project/stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let input: ProjectReviewStreamInput;
        try {
          input = (await request.json()) as ProjectReviewStreamInput;
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }

        return new Response(createProjectReviewStream(input), {
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
