import { mutationOptions, queryOptions } from "@tanstack/react-query";

import { getOutcomes, type OutcomesResult, startOutcomes } from "../server/outcomes.functions.js";

const outcomesKeys = {
  all: ["outcomes"] as const,
};

/** How often the outcomes are re-read while a scan is running. */
const POLL_MS = 2000;

/** Polls only while a scan is running; otherwise the saved results do not change. */
export function outcomesRefetchInterval(result: OutcomesResult | undefined): number | false {
  return result?.ok === true && result.view.scan.running ? POLL_MS : false;
}

/** The saved outcome results and the state of any running scan. Never starts a scan. */
export const outcomesQuery = queryOptions({
  queryKey: outcomesKeys.all,
  queryFn: () => getOutcomes(),
  refetchInterval: (query) => outcomesRefetchInterval(query.state.data),
});

/**
 * Starts a background scan (`refresh` rescans everything). The returned scan
 * state goes straight into the cache, so polling starts at once, and the
 * outcomes are then re-read.
 */
export const startOutcomesMutation = mutationOptions({
  mutationFn: (refresh: boolean) => startOutcomes({ data: { refresh } }),
  onSuccess: (result, _refresh, _onMutateResult, { client }) => {
    client.setQueryData(outcomesQuery.queryKey, result);
  },
  onSettled: (_result, _error, _refresh, _onMutateResult, { client }) =>
    client.invalidateQueries({ queryKey: outcomesQuery.queryKey }),
});
