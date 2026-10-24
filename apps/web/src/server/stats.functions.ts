import { createServerFn } from "@tanstack/react-start";

import { loadLiveStats } from "./stats.server.js";

/** Result of a live stats request; platform failures are returned, not thrown. */
export type LiveStatsResult =
  | { readonly ok: true; readonly stats: Awaited<ReturnType<typeof loadLiveStats>> }
  | { readonly ok: false; readonly error: string };

/** Server function that queries the configured platform for PR review totals. */
export const getLiveStats = createServerFn({ method: "GET", strict: { output: false } })
  .validator((data: { days: number }) => data)
  .handler(async ({ data }): Promise<LiveStatsResult> => {
    try {
      return { ok: true, stats: await loadLiveStats(data.days) };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });
