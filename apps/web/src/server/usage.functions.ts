import { createServerFn } from "@tanstack/react-start";

import { loadUsageSummary } from "./usage.server.js";

/** Result of a usage request; failures are returned, not thrown. */
export type UsageResult =
  | { readonly ok: true; readonly usage: Awaited<ReturnType<typeof loadUsageSummary>> }
  | { readonly ok: false; readonly error: string };

/** Server function that summarizes AI token usage from local review reports. */
export const getUsageStats = createServerFn({ method: "GET", strict: { output: false } })
  .validator((data: { days: number }) => data)
  .handler(async ({ data }): Promise<UsageResult> => {
    try {
      return { ok: true, usage: await loadUsageSummary(data.days) };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });
