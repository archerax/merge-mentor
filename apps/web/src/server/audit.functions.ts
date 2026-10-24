import { createServerFn } from "@tanstack/react-start";

import { loadAuditEvents } from "./audit.server.js";

/**
 * Server function that returns the most recent audit log entries.
 *
 * Output serialization checks are relaxed because audit `metadata`/`resource.details`
 * are arbitrary JSON payloads typed as `Record<string, unknown>`; they are always
 * serializable at runtime but cannot be statically proven.
 */
export const getAuditEvents = createServerFn({
  method: "GET",
  strict: { output: false },
}).handler(async () => {
  return loadAuditEvents(500);
});
