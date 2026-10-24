import { loadConfig, validateConfig } from "@merge-mentor/config/config.js";
import {
  collectLiveReviewStats,
  type LiveReviewStats,
} from "@merge-mentor/core/review/reviewStats.js";
import type { Platform } from "@merge-mentor/domain/platform.js";
import { AzureDevOpsAdapter } from "@merge-mentor/platforms/azure.js";
import { GitHubAdapter } from "@merge-mentor/platforms/github.js";
import { initLogger } from "@merge-mentor/shared/logger.js";

import { refreshEnv } from "./env.server.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Maximum PRs inspected per request, bounding platform API usage. */
const MAX_PRS = 100;

/** How long a scan result is reused, so hovering/reloading the page cannot re-scan the platform. */
const CACHE_TTL_MS = 60_000;

/** Largest accepted window in days. */
const MAX_DAYS = 365;

const cache = new Map<string, { readonly at: number; readonly stats: Promise<LiveReviewStats> }>();

/**
 * Gathers live review statistics for the repository configured in the environment.
 *
 * Results are cached briefly per repository and window.
 *
 * @param days - Only inspect PRs with activity in the last this many days (1-365)
 * @returns Totals queried directly from the platform's real PRs
 */
export async function loadLiveStats(days: number): Promise<LiveReviewStats> {
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new Error(`days must be an integer between 1 and ${MAX_DAYS}.`);
  }

  refreshEnv();
  const config = loadConfig();
  const platform = config.defaultPlatform as Platform;
  if (platform !== "github" && platform !== "azure") {
    throw new Error(`Invalid platform "${platform}". Must be "github" or "azure".`);
  }
  validateConfig(config, platform);
  initLogger(config.tempPath);

  const adapter =
    platform === "github" ? new GitHubAdapter(config) : new AzureDevOpsAdapter(config);
  const key = `${platform}:${adapter.getProjectIdentifier()}:${days}`;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.stats;

  const stats = collectLiveReviewStats(adapter, {
    since: new Date(Date.now() - days * MS_PER_DAY),
    limit: MAX_PRS,
  });
  cache.set(key, { at: Date.now(), stats });
  // Failed scans must not be served from the cache.
  stats.catch(() => cache.delete(key));
  return stats;
}
