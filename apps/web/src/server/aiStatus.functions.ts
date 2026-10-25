import { createServerFn } from "@tanstack/react-start";

import { loadAiStatus } from "./aiStatus.server.js";

/**
 * Server function that reports which identity AI requests will run under
 * (Copilot user, BYOK endpoint, or another provider). Secrets are never returned.
 */
export const getAiStatus = createServerFn({ method: "GET", strict: { output: false } })
  .validator((data: unknown) => ({ force: (data as { force?: unknown } | null)?.force === true }))
  .handler(async ({ data }) => loadAiStatus(data.force));
