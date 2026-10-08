import { createServerFn } from "@tanstack/react-start";

import { loadReport, loadReports } from "./reports.server.js";

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
