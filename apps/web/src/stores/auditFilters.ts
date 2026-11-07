import type { AuditLogSeverity } from "@merge-mentor/shared/audit/index.js";

import { asRecord, createPersistedStore } from "./persisted.js";

/** The audit log's severity filter: one severity, or every event. */
export type SeverityFilter = "all" | AuditLogSeverity;

/** Every audit severity; the compiler fails here when `AuditLogSeverity` gains or loses one. */
const SEVERITY_SET = { info: true, warn: true, error: true } satisfies Record<
  AuditLogSeverity,
  true
>;

const SEVERITY_FILTERS: readonly SeverityFilter[] = [
  "all",
  ...(Object.keys(SEVERITY_SET) as AuditLogSeverity[]),
];

interface AuditFiltersState {
  readonly severity: SeverityFilter;
  readonly query: string;
  setSeverity(severity: SeverityFilter): void;
  setQuery(query: string): void;
}

type PersistedAuditFilters = Pick<AuditFiltersState, "severity" | "query">;

function isSeverityFilter(value: unknown): value is SeverityFilter {
  return SEVERITY_FILTERS.includes(value as SeverityFilter);
}

/** Keeps the well-formed audit filter fields from storage. */
function sanitizeAuditFilters(persisted: unknown): Partial<PersistedAuditFilters> {
  const record = asRecord(persisted);
  if (!record) return {};
  return {
    ...(isSeverityFilter(record.severity) ? { severity: record.severity } : {}),
    ...(typeof record.query === "string" ? { query: record.query } : {}),
  };
}

/** Audit log filters, kept for the browser tab. */
export const useAuditFiltersStore = createPersistedStore<AuditFiltersState, PersistedAuditFilters>(
  (set) => ({
    severity: "all",
    query: "",
    setSeverity: (severity) => set({ severity }),
    setQuery: (query) => set({ query }),
  }),
  {
    name: "audit-filters",
    version: 1,
    partialize: ({ severity, query }) => ({ severity, query }),
    sanitize: sanitizeAuditFilters,
  }
);

/** Subscribes to the audit log's severity filter and search text. */
export function useAuditFilters() {
  const severity = useAuditFiltersStore((state) => state.severity);
  const query = useAuditFiltersStore((state) => state.query);
  const setSeverity = useAuditFiltersStore((state) => state.setSeverity);
  const setQuery = useAuditFiltersStore((state) => state.setQuery);
  return { severity, query, setSeverity, setQuery };
}
