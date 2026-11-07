import { mutationOptions, queryOptions } from "@tanstack/react-query";

import { getConfig, saveConfig } from "../server/config.functions.js";
import type { ConfigEdit, ConfigSaveResult, ConfigView } from "../server/config.types.js";

const configKeys = {
  all: ["config"] as const,
};

/** The sanitized merged configuration; secrets are never included. */
export const configQuery = queryOptions({
  queryKey: configKeys.all,
  queryFn: (): Promise<ConfigView> => getConfig(),
});

/**
 * Writes configuration edits to the project `.env` file. A save the server
 * accepts puts the returned configuration straight into the cache and marks
 * every other query stale, since every page's data depends on the settings.
 * The configuration is not re-read afterwards: the returned view is built after
 * the write, and a failed re-read of a suspense query would replace the page.
 * Rejected values come back as `{ ok: false, errors }`, not as an error.
 */
export const saveConfigMutation = mutationOptions({
  mutationFn: (edits: readonly ConfigEdit[]): Promise<ConfigSaveResult> =>
    saveConfig({ data: { edits } }),
  onSuccess: (result, _edits, _onMutateResult, { client }) => {
    if (!result.ok) return;
    client.setQueryData(configQuery.queryKey, result.view);
    // Refetched in the background; the save does not wait for other pages' data.
    void client.invalidateQueries({
      predicate: (query) => query.queryKey[0] !== configKeys.all[0],
    });
  },
});
