import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { getAiStatus } from "../server/aiStatus.functions.js";
import type { AiStatus } from "../server/aiStatus.types.js";

const aiStatusKeys = {
  all: ["aiStatus"] as const,
};

/**
 * Calls the server function. A failure is reported as a `copilot-error`
 * status rather than a query error, so the status bar always has something
 * to show.
 */
async function fetchAiStatus(force: boolean): Promise<AiStatus> {
  try {
    return await getAiStatus({ data: { force } });
  } catch (error) {
    return { kind: "copilot-error", message: (error as Error).message };
  }
}

/** Which identity AI requests will run under, using the server's short-lived cache. */
export const aiStatusQuery = queryOptions({
  queryKey: aiStatusKeys.all,
  queryFn: () => fetchAiStatus(false),
});

/** Re-checks the AI account, bypassing the server cache, and stores the result. */
export async function refreshAiStatus(queryClient: QueryClient): Promise<AiStatus> {
  const status = await fetchAiStatus(true);
  queryClient.setQueryData(aiStatusQuery.queryKey, status);
  return status;
}
