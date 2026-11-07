import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { getLiveStats } from "../server/stats.functions.js";

const statsKeys = {
  all: ["stats"] as const,
  detail: (days: number) => [...statsKeys.all, "detail", days] as const,
};

/**
 * Live review totals for the PRs of the last `days` days. Platform failures
 * come back as `{ ok: false }`, not as query errors. Each request scans the
 * platform, so the result is kept fresh for a minute. While another window
 * loads, the previous window's totals stay on screen (`isPlaceholderData`).
 * Refocusing the tab does not refetch, so switching windows never triggers a scan.
 */
export function statsQuery(days: number) {
  return queryOptions({
    queryKey: statsKeys.detail(days),
    queryFn: () => getLiveStats({ data: { days } }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}
