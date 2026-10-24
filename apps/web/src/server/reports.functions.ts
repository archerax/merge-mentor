import { createServerFn } from "@tanstack/react-start";

import { loadReport, loadReports, removePrdRun } from "./reports.server.js";

/**
 * Server function that returns metadata for the most recent markdown reports.
 *
 * Output serialization checks are relaxed because summaries include arbitrary
 * title text and timestamps that cannot be statically proven serializable.
 */
export const getReports = createServerFn({
  method: "GET",
  strict: { output: false },
}).handler(async () => {
  return loadReports(200);
});

/** Server function that returns a single markdown report by file name. */
export const getReport = createServerFn({
  method: "GET",
  strict: { output: false },
})
  .validator((data: { name: string }) => data)
  .handler(async ({ data }) => {
    return (await loadReport(data.name)) ?? null;
  });

/**
 * Server function that deletes a PRD review run (reports, stored upload,
 * extracted data and images, AI transcripts). The run id is validated server-side before any path is built.
 */
export const deletePrdReport = createServerFn({ method: "POST" })
  .validator((data: { runId: string }) => data)
  .handler(async ({ data }) => {
    await removePrdRun(data.runId);
    return { deleted: true };
  });
