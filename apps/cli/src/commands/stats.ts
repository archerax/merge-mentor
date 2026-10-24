import { join } from "node:path";

import { loadConfig } from "@merge-mentor/config/config.js";
import { readAuditEvents } from "@merge-mentor/shared/audit/auditReader.js";
import { computeAuditStats, type AuditStats } from "@merge-mentor/shared/audit/auditStats.js";
import { consoleOutputWriter } from "@merge-mentor/shared/ports/index.js";
import { InvalidArgumentError } from "commander";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Options accepted by the `stats` command. */
export interface StatsOptions {
  readonly since?: Date;
  readonly json?: boolean;
  readonly tempPath?: string;
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
 * how many comments have been posted, based on the persisted audit logs.
 *
 * @param options - Time window, output format, and temp path override
 */
export async function executeStatsCommand(options: StatsOptions): Promise<void> {
  const config = loadConfig({ tempPath: options.tempPath });
  const entries = await readAuditEvents({ logsDir: join(config.tempPath, "logs") });
  const stats = computeAuditStats(entries, { since: options.since });

  if (options.json) {
    consoleOutputWriter.log(JSON.stringify(stats, null, 2));
    return;
  }

  for (const line of formatStats(stats, options.since)) consoleOutputWriter.log(line);
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
