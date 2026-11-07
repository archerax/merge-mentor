import { mutationOptions, queryOptions } from "@tanstack/react-query";

import { deletePrdReport, getReport, getReports } from "../server/reports.functions.js";
import type { ReportListItem } from "../server/reports.server.js";

const reportsKeys = {
  all: ["reports"] as const,
  list: () => [...reportsKeys.all, "list"] as const,
  detail: (name: string) => [...reportsKeys.all, "detail", name] as const,
};

/** Metadata for the most recent saved markdown reports. */
export const reportsQuery = queryOptions({
  queryKey: reportsKeys.list(),
  queryFn: (): Promise<readonly ReportListItem[]> => getReports(),
});

/** One saved report by file name; `null` when it no longer exists. */
export function reportQuery(name: string) {
  return queryOptions({
    queryKey: reportsKeys.detail(name),
    queryFn: () => getReport({ data: { name } }),
  });
}

/**
 * The report to show first: the one named in the URL when it is in the list,
 * otherwise the newest one, or `null` when there are no reports.
 */
export function initialReportName(
  reports: readonly ReportListItem[],
  requested: string | undefined
): string | null {
  return (reports.find((item) => item.name === requested) ?? reports[0])?.name ?? null;
}

/** What `onMutate` saved so a failed delete can put the list back. */
interface DeleteSnapshot {
  readonly previous: readonly ReportListItem[] | undefined;
}

/**
 * Deletes a PRD review run (its review and breakdown reports and stored
 * files). The run's reports leave the cached list at once and come back if the
 * server refuses; the list is refetched either way.
 */
export const deletePrdRunMutation = mutationOptions({
  mutationFn: (runId: string) => deletePrdReport({ data: { runId } }),
  onMutate: async (runId, { client }): Promise<DeleteSnapshot> => {
    await client.cancelQueries({ queryKey: reportsQuery.queryKey });
    const previous = client.getQueryData(reportsQuery.queryKey);
    client.setQueryData(reportsQuery.queryKey, (list) =>
      list?.filter((report) => report.prdRunId !== runId)
    );
    return { previous };
  },
  onSuccess: (_result, runId, snapshot, { client }) => {
    for (const report of snapshot.previous ?? []) {
      if (report.prdRunId === runId)
        client.removeQueries({ queryKey: reportsKeys.detail(report.name) });
    }
  },
  onError: (_error, _runId, snapshot, { client }) => {
    if (snapshot) client.setQueryData(reportsQuery.queryKey, snapshot.previous);
  },
  onSettled: (_result, _error, _runId, _snapshot, { client }) =>
    client.invalidateQueries({ queryKey: reportsQuery.queryKey }),
});
