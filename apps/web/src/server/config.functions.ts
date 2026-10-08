import { createServerFn } from "@tanstack/react-start";

import { applyConfigEdits, buildConfigView } from "./config.server.js";
import type { ConfigEdit } from "./config.types.js";

/**
 * Server function that returns a sanitized snapshot of the merged
 * configuration. Sensitive values are never included in the payload.
 */
export const getConfig = createServerFn({
  method: "GET",
  strict: { output: false },
}).handler(async () => {
  return buildConfigView();
});

/** Coerces arbitrary input into a safe list of configuration edits. */
function toEdits(data: unknown): readonly ConfigEdit[] {
  const raw = (data as { edits?: unknown } | null)?.edits;
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item): ConfigEdit[] => {
    if (typeof item !== "object" || item === null) return [];
    const { envVar, value } = item as { envVar?: unknown; value?: unknown };
    if (typeof envVar !== "string" || typeof value !== "string") return [];
    return [{ envVar, value }];
  });
}

/**
 * Server function that validates and persists configuration edits to the
 * project `.env` file, returning the refreshed configuration.
 */
export const saveConfig = createServerFn({
  method: "POST",
  strict: { output: false },
})
  .validator((data: unknown) => ({ edits: toEdits(data) }))
  .handler(async ({ data }) => {
    return applyConfigEdits(data.edits);
  });
