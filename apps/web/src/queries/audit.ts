import { queryOptions } from "@tanstack/react-query";

import { getAuditEvents } from "../server/audit.functions.js";

const auditKeys = {
  all: ["audit"] as const,
  list: () => [...auditKeys.all, "list"] as const,
};

/** The most recent structured audit events from `.mergementor/logs`. */
export const auditQuery = queryOptions({
  queryKey: auditKeys.list(),
  queryFn: () => getAuditEvents(),
});
