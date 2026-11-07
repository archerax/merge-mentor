import { createServerFn } from "@tanstack/react-start";

import { loadOutcomes, type OutcomesView, startOutcomesScan } from "./outcomes.server.js";

/** Result of an outcomes request; configuration and platform failures are returned, not thrown. */
export type OutcomesResult =
  | { readonly ok: true; readonly view: OutcomesView }
  | { readonly ok: false; readonly error: string };

/** Server function that returns the saved outcome results and scan state. It never scans. */
export const getOutcomes = createServerFn({ method: "GET", strict: { output: false } }).handler(
  async (): Promise<OutcomesResult> => {
    try {
      return { ok: true, view: await loadOutcomes() };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
);

/** Server function that starts a background scan of the last 12 months. */
export const startOutcomes = createServerFn({ method: "POST", strict: { output: false } })
  .validator((data: { refresh: boolean }) => data)
  .handler(async ({ data }): Promise<OutcomesResult> => {
    try {
      startOutcomesScan(data.refresh);
      return { ok: true, view: await loadOutcomes() };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });
