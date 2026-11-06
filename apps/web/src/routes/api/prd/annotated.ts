import { createFileRoute } from "@tanstack/react-router";

import { handleAnnotatedDownload } from "../../../server/prdAnnotated.server.js";

/**
 * Server route that downloads the annotated copy of a PRD / FRD review
 * (`GET ?run=<prdRunId>`): the reviewed document with the findings as Word
 * comments. Server-only.
 */
export const Route = createFileRoute("/api/prd/annotated")({
  server: {
    handlers: {
      GET: ({ request }) => handleAnnotatedDownload(request),
    },
  },
});
