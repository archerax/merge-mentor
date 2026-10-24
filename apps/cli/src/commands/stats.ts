import { loadConfig, validateConfig } from "@merge-mentor/config/config.js";
import {
  collectLiveReviewStats,
  type LiveReviewStats,
} from "@merge-mentor/core/review/reviewStats.js";
import type { Platform } from "@merge-mentor/domain/platform.js";
import { AzureDevOpsAdapter } from "@merge-mentor/platforms/azure.js";
import { GitHubAdapter } from "@merge-mentor/platforms/github.js";
import { initLogger } from "@merge-mentor/shared/logger.js";
import { consoleOutputWriter } from "@merge-mentor/shared/ports/index.js";
import { InvalidArgumentError } from "commander";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Options accepted by the `stats` command. */
export interface StatsOptions {
  readonly since?: Date;
  /** Maximum number of PRs to inspect. */
  readonly limit?: number;
  readonly json?: boolean;
  readonly tempPath?: string;
  readonly platform?: string;
  readonly githubToken?: string;
  readonly githubRepoOwner?: string;
  readonly githubRepoName?: string;
  readonly azureToken?: string;
  readonly azureOrg?: string;
  readonly azureProject?: string;
  readonly azureRepo?: string;
}

/** Default number of PRs inspected. */
export const DEFAULT_STATS_PR_LIMIT = 100;

/** Default window, keeping API usage bounded. */
const DEFAULT_LIVE_WINDOW_DAYS = 30;

/** Largest accepted `--limit`; each PR costs at least two API calls, so this bounds quota use. */
const MAX_STATS_PR_LIMIT = 1000;

/**
 * Parses the `--limit` option.
 *
 * @param value - Raw option value
 * @returns An integer between 1 and {@link MAX_STATS_PR_LIMIT}
 * @throws InvalidArgumentError when the value is not an integer in that range
 */
export function parseLimit(value: string): number {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new InvalidArgumentError("Expected a positive integer.");
  }
  if (limit > MAX_STATS_PR_LIMIT) {
    throw new InvalidArgumentError(`Expected at most ${MAX_STATS_PR_LIMIT}.`);
  }
  return limit;
}

/**
 * Parses a `--since` value: either a relative window such as `30d`, or a date.
 *
 * @param value - Raw option value
 * @returns The start of the window
 * @throws InvalidArgumentError when the value is neither `<n>d` nor a parseable date
 */
export function parseSince(value: string, now: Date = new Date()): Date {
  const relative = /^(\d+)d$/.exec(value.trim());
  if (relative) {
    const windowStart = new Date(now.getTime() - Number(relative[1]) * MS_PER_DAY);
    if (!Number.isNaN(windowStart.getTime())) return windowStart;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidArgumentError("Expected a date (e.g. 2026-01-31) or a window such as 30d.");
  }
  return date;
}

/**
 * Executes the `stats` command: summarizes how many PRs Merge Mentor has reviewed
 * and how many comments it has posted, by querying the platform's real PRs.
 *
 * @param options - Time window, platform settings, and output format
 */
export async function executeStatsCommand(options: StatsOptions): Promise<void> {
  const config = loadConfig({
    platform: options.platform,
    githubToken: options.githubToken,
    githubRepoOwner: options.githubRepoOwner,
    githubRepoName: options.githubRepoName,
    azureToken: options.azureToken,
    azureOrg: options.azureOrg,
    azureProject: options.azureProject,
    azureRepo: options.azureRepo,
    tempPath: options.tempPath,
  });
  const platform = (options.platform ?? config.defaultPlatform) as Platform;
  if (platform !== "github" && platform !== "azure") {
    throw new Error(`Invalid platform "${platform}". Must be "github" or "azure".`);
  }
  validateConfig(config, platform);
  initLogger(config.tempPath);

  const adapter =
    platform === "github" ? new GitHubAdapter(config) : new AzureDevOpsAdapter(config);
  const since = options.since ?? new Date(Date.now() - DEFAULT_LIVE_WINDOW_DAYS * MS_PER_DAY);
  const stats = await collectLiveReviewStats(adapter, {
    since,
    limit: options.limit ?? DEFAULT_STATS_PR_LIMIT,
  });

  if (options.json) {
    consoleOutputWriter.log(JSON.stringify({ since: since.toISOString(), ...stats }, null, 2));
    return;
  }

  for (const line of formatLiveStats(stats, since)) consoleOutputWriter.log(line);
}

/**
 * Renders live platform statistics as human-readable lines.
 *
 * @param stats - Statistics gathered from the platform
 * @param since - Start of the inspected window
 * @returns Lines to print
 */
export function formatLiveStats(stats: LiveReviewStats, since: Date): string[] {
  const lines = [
    "",
    `📊 Merge Mentor stats for ${stats.project} (${stats.platform}, PRs since ${since.toISOString()})`,
    "",
    `  PRs scanned:      ${stats.prsScanned}`,
    `  PRs reviewed:     ${stats.prsReviewed}`,
    `  Comments posted:  ${stats.totalComments}` +
      ` (${stats.inlineComments} inline, ${stats.generalComments} general)`,
  ];
  if (stats.prsFailed > 0) {
    lines.push(`  PRs unreadable:   ${stats.prsFailed} (excluded from totals)`);
  }

  if (stats.reviewedPullRequests.length > 0) {
    lines.push("", "  Reviewed PRs:");
    for (const pr of stats.reviewedPullRequests) {
      lines.push(
        `    #${pr.number} [${pr.state}] ${pr.title} — ${pr.inlineComments + pr.generalComments} comments`
      );
    }
  }
  if (stats.truncated) {
    lines.push(
      "",
      "  ⚠️  PR limit reached; older PRs were not counted. Raise --limit to include them."
    );
  }
  lines.push("");
  return lines;
}
