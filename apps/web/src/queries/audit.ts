import { queryOptions } from "@tanstack/react-query";

import { getAuditEvents } from "../server/audit.functions.js";

const auditKeys = {
  all: ["audit"] as const,
  list: () => [...auditKeys.all, "list"] as const,
};

/** Short enough to re-read on navigation, long enough to dedupe loader and mount. */
const AUDIT_STALE_MS = 5000;

/** The most recent structured audit events from `.mergementor/logs`. */
export const auditQuery = queryOptions({
  queryKey: auditKeys.list(),
  queryFn: () => getAuditEvents(),
  // New events can appear at any time and nothing invalidates this key, so
  // revisiting the page re-reads the log. Unlike staleTime 0, a few seconds
  // keeps the route loader's fetch and the page's own mount from fetching twice.
  staleTime: AUDIT_STALE_MS,
});
