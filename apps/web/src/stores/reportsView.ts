import { asRecord, createPersistedStore } from "./persisted.js";

/** A report the user clicked, remembered against the `report` search parameter it was picked under. */
interface ReportPick {
  readonly search: string | undefined;
  readonly name: string | null;
}

interface ReportsViewState {
  readonly query: string;
  readonly pick: ReportPick | null;
  setQuery(query: string): void;
  setPick(pick: ReportPick | null): void;
}

type PersistedReportsView = Pick<ReportsViewState, "query" | "pick">;

function sanitizePick(value: unknown): ReportPick | null | undefined {
  if (value === null) return null;
  const record = asRecord(value);
  if (!record) return undefined;
  const { search, name } = record;
  if (search !== undefined && typeof search !== "string") return undefined;
  if (name !== null && typeof name !== "string") return undefined;
  return { search, name };
}

/** Keeps the well-formed reports page fields from storage. */
function sanitizeReportsView(persisted: unknown): Partial<PersistedReportsView> {
  const record = asRecord(persisted);
  if (!record) return {};
  const pick = sanitizePick(record.pick);
  return {
    ...(typeof record.query === "string" ? { query: record.query } : {}),
    ...(pick !== undefined ? { pick } : {}),
  };
}

/** The reports page's search text and last selected report, kept for the browser tab. */
export const useReportsViewStore = createPersistedStore<ReportsViewState, PersistedReportsView>(
  (set) => ({
    query: "",
    pick: null,
    setQuery: (query) => set({ query }),
    setPick: (pick) => set({ pick }),
  }),
  {
    name: "reports-view",
    version: 1,
    partialize: ({ query, pick }) => ({ query, pick }),
    sanitize: sanitizeReportsView,
  }
);

/** Subscribes to the reports search text. */
export function useReportsQuery() {
  const query = useReportsViewStore((state) => state.query);
  const setQuery = useReportsViewStore((state) => state.setQuery);
  return { query, setQuery };
}

/** Subscribes to the last report the user picked. */
export function useReportPick() {
  const pick = useReportsViewStore((state) => state.pick);
  const setPick = useReportsViewStore((state) => state.setPick);
  return { pick, setPick };
}
