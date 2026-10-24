import { loadConfig, validateConfig } from "@merge-mentor/config/config.js";
import {
  collectLiveReviewStats,
  type LiveReviewStats,
} from "@merge-mentor/core/review/reviewStats.js";
import type { Platform } from "@merge-mentor/domain/platform.js";
import { AzureDevOpsAdapter } from "@merge-mentor/platforms/azure.js";
import { GitHubAdapter } from "@merge-mentor/platforms/github.js";

import { refreshEnv } from "./env.server.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Maximum PRs inspected per request, bounding platform API usage. */
const MAX_PRS = 100;

/**
 * Gathers live review statistics for the repository configured in the environment.
 *
 * @param days - Only inspect PRs with activity in the last this many days
 * @returns Totals queried directly from the platform's real PRs
 */
export async function loadLiveStats(days: number): Promise<LiveReviewStats> {
  refreshEnv();
  const config = loadConfig();
  const platform = config.defaultPlatform as Platform;
  if (platform !== "github" && platform !== "azure") {
    throw new Error(`Invalid platform "${platform}". Must be "github" or "azure".`);
  }
  validateConfig(config, platform);

  const adapter =
    platform === "github" ? new GitHubAdapter(config) : new AzureDevOpsAdapter(config);
  return collectLiveReviewStats(adapter, {
    since: new Date(Date.now() - days * MS_PER_DAY),
    limit: MAX_PRS,
  });
}
