import { join } from "node:path";

import { loadConfig, validateConfig } from "@merge-mentor/config/config.js";
import {
  collectLiveReviewStats,
  type LiveReviewStats,
} from "@merge-mentor/core/review/reviewStats.js";
import type { Platform } from "@merge-mentor/domain/platform.js";
import { AzureDevOpsAdapter } from "@merge-mentor/platforms/azure.js";
import { GitHubAdapter } from "@merge-mentor/platforms/github.js";
import { readAuditEvents } from "@merge-mentor/shared/audit/auditReader.js";
import { computeAuditStats, type AuditStats } from "@merge-mentor/shared/audit/auditStats.js";
import { consoleOutputWriter } from "@merge-mentor/shared/ports/index.js";
import { InvalidArgumentError } from "commander";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Options accepted by the `stats` command. */
export interface StatsOptions {
  /** `live` queries the platform's real PRs; `audit` reads local audit logs. Default: `live`. */
  readonly source?: string;
  readonly since?: Date;
  /** Maximum number of PRs to inspect in live mode. */
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

/** Default number of PRs inspected in live mode. */
export const DEFAULT_STATS_PR_LIMIT = 100;

/** Default window for live mode, keeping API usage bounded. */
const DEFAULT_LIVE_WINDOW_DAYS = 30;

/**
 * Parses the `--limit` option.
 *
 * @param value - Raw option value
 * @returns A positive integer
 * @throws InvalidArgumentError when the value is not a positive integer
 */
export function parseLimit(value: string): number {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new InvalidArgumentError("Expected a positive integer.");
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
  if (relative) return new Date(now.getTime() - Number(relative[1]) * MS_PER_DAY);

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidArgumentError("Expected a date (e.g. 2026-01-31) or a window such as 30d.");
  }
  return date;
}

/**
 * Executes the `stats` command: summarizes how many PRs have been reviewed and
 * how many comments have been posted, either from the platform's real PRs (default)
 * or from the persisted audit logs.
 *
 * @param options - Source, time window, platform settings, and output format
 */
export async function executeStatsCommand(options: StatsOptions): Promise<void> {
  const source = options.source ?? "live";
  if (source !== "live" && source !== "audit") {
    throw new Error(`Invalid source "${source}". Must be "live" or "audit".`);
  }

  if (source === "audit") {
    await executeAuditStats(options);
  } else {
    await executeLiveStats(options);
  }
}

async function executeAuditStats(options: StatsOptions): Promise<void> {
  const config = loadConfig({ tempPath: options.tempPath });
  const entries = await readAuditEvents({ logsDir: join(config.tempPath, "logs") });
  const stats = computeAuditStats(entries, { since: options.since });

  if (options.json) {
    consoleOutputWriter.log(JSON.stringify(stats, null, 2));
    return;
  }

  for (const line of formatStats(stats, options.since)) consoleOutputWriter.log(line);
}

async function executeLiveStats(options: StatsOptions): Promise<void> {
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

/**
 * Renders statistics as human-readable lines.
 *
 * @param stats - Aggregated statistics
 * @param since - Start of the window, when one was requested
 * @returns Lines to print
 */
export function formatStats(stats: AuditStats, since?: Date): string[] {
  const lines = ["", `📊 Merge Mentor stats${since ? ` (since ${since.toISOString()})` : ""}`, ""];

  if (stats.reviewRuns === 0 && stats.comments.total === 0 && stats.comments.failed === 0) {
    lines.push("  No review activity found in the audit logs.", "");
    return lines;
  }

  const { comments } = stats;
  lines.push(
    `  PRs reviewed:     ${stats.prsReviewed}`,
    `  Review runs:      ${stats.reviewRuns}`,
    `  Files reviewed:   ${stats.filesReviewed}`,
    `  Comments posted:  ${comments.total}` +
      ` (${comments.inline} inline, ${comments.replies} replies, ${comments.general} general)`
  );
  if (comments.failed > 0) lines.push(`  Comments failed:  ${comments.failed}`);

  if (stats.byPlatform.length > 1) {
    lines.push("", "  By platform:");
    for (const p of stats.byPlatform) {
      lines.push(
        `    ${p.platform}: ${p.prsReviewed} PRs, ${p.reviewRuns} runs, ${p.comments.total} comments`
      );
    }
  }

  if (stats.firstEventAt && stats.lastEventAt) {
    lines.push("", `  Activity from ${stats.firstEventAt} to ${stats.lastEventAt}`);
  }
  lines.push("");
  return lines;
}
