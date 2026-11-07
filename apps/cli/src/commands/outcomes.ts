import { loadConfig, validateConfig } from "@merge-mentor/config/config.js";
import { outcomesFilePath } from "@merge-mentor/core/review/outcomes/cache.js";
import {
  outcomesProject,
  type ScanOutcomesResult,
  scanOutcomes,
} from "@merge-mentor/core/review/outcomes/scanner.js";
import type { OutcomeCounts } from "@merge-mentor/core/review/outcomes/types.js";
import type { Platform } from "@merge-mentor/domain/platform.js";
import { AzureDevOpsAdapter } from "@merge-mentor/platforms/azure.js";
import { GitHubAdapter } from "@merge-mentor/platforms/github.js";
import { initLogger } from "@merge-mentor/shared/logger.js";
import { consoleOutputWriter } from "@merge-mentor/shared/ports/index.js";
import { InvalidArgumentError } from "commander";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Options accepted by the `outcomes` command. */
export interface OutcomesOptions {
  readonly since?: Date;
  /** Maximum number of PRs to scan. */
  readonly limit?: number;
  /** Scan only this PR (it must be inside the window). */
  readonly pr?: number;
  /** Ignore the cache and rescan everything. */
  readonly refresh?: boolean;
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

/** Default window: the last 12 months. */
export const DEFAULT_OUTCOMES_WINDOW = "12m";

/** Default number of PRs scanned. */
export const DEFAULT_OUTCOMES_PR_LIMIT = 1000;

/**
 * Parses a `--since` value: a relative window (`30d`, `6m`, `1y`) or a date.
 *
 * @param value - Raw option value
 * @param now - Current time, injectable for tests
 * @returns The start of the window
 * @throws InvalidArgumentError when the value is neither a window nor a parseable date
 */
export function parseOutcomesSince(value: string, now: Date = new Date()): Date {
  const relative = /^(\d+)([dmy])$/.exec(value.trim());
  if (relative) {
    const amount = Number(relative[1]);
    const start = new Date(now.getTime());
    if (relative[2] === "d") start.setTime(now.getTime() - amount * MS_PER_DAY);
    else start.setUTCMonth(start.getUTCMonth() - amount * (relative[2] === "y" ? 12 : 1));
    if (!Number.isNaN(start.getTime())) return start;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidArgumentError(
      "Expected a date (e.g. 2026-01-31) or a window such as 30d, 6m or 1y."
    );
  }
  return date;
}

/**
 * Parses the `--pr` option.
 *
 * @param value - Raw option value
 * @throws InvalidArgumentError when it is not a positive integer
 */
export function parsePrNumber(value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new InvalidArgumentError("Expected a positive PR number.");
  }
  return number;
}

/**
 * Executes the `outcomes` command: scans the repository's PRs, works out what
 * became of the review threads Merge Mentor started, and prints the totals.
 * It only reads from the platform; results are saved under the temp path.
 *
 * @param options - Window, platform settings, and output format
 */
export async function executeOutcomesCommand(options: OutcomesOptions): Promise<void> {
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
  const since = options.since ?? parseOutcomesSince(DEFAULT_OUTCOMES_WINDOW);
  const result = await scanOutcomes(adapter, {
    since,
    limit: options.limit ?? DEFAULT_OUTCOMES_PR_LIMIT,
    project: outcomesProject(config, platform),
    tempPath: config.tempPath,
    refresh: options.refresh,
    onlyPr: options.pr,
    onProgress: options.json
      ? undefined
      : (done, total) => {
          if (done % 25 === 0 && done < total) {
            consoleOutputWriter.error(`  Scanned ${done}/${total} PRs...`);
          }
        },
  });

  if (options.json) {
    consoleOutputWriter.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const line of formatOutcomes(result, outcomesFilePath(config.tempPath))) {
    consoleOutputWriter.log(line);
  }
}

function percent(rate: number | null): string {
  return rate === null ? "n/a" : `${Math.round(rate * 100)}%`;
}

function breakdownTable(title: string, rows: readonly [string, OutcomeCounts][]): string[] {
  if (rows.length === 0) return [];
  const width = Math.max(title.length, ...rows.map(([name]) => name.length));
  const line = (cells: (string | number)[]): string =>
    `    ${String(cells[0]).padEnd(width)}  ${cells
      .slice(1)
      .map((cell) => String(cell).padStart(8))
      .join("")}`;
  return [
    "",
    line([title, "Total", "Resolved", "Left open", "In flight", "Rate"]),
    ...rows.map(([name, c]) =>
      line([
        name,
        c.total,
        c.resolved,
        c.openMerged + c.openClosed,
        c.open,
        percent(c.resolutionRate),
      ])
    ),
  ];
}

/**
 * Renders outcome statistics as human-readable lines.
 *
 * @param result - Result of a scan
 * @param file - Path of the saved results file
 * @returns Lines to print
 */
export function formatOutcomes(result: ScanOutcomesResult, file: string): string[] {
  const { stats } = result;
  const lines = [
    "",
    `📈 Merge Mentor outcomes for ${result.project} (${result.platform}, PRs since ${result.since})`,
    "",
    `  PRs scanned:          ${stats.prsScanned} (${result.prsFetched} fetched, ${result.prsFromCache} from cache)`,
    `  PRs with comments:    ${stats.prsWithComments}`,
    `  Review threads:       ${stats.total}`,
    `    Resolved:           ${stats.resolved}`,
    `    Left open (merged): ${stats.openMerged}`,
    `    Left open (closed): ${stats.openClosed}`,
    `    Still in flight:    ${stats.open}`,
    `  Resolution rate:      ${percent(stats.resolutionRate)}` +
      "  (resolved / threads that reached an outcome)",
  ];
  if (result.prsFailed > 0) {
    lines.push(`  PRs unreadable:       ${result.prsFailed} (excluded from totals)`);
  }
  lines.push(
    ...breakdownTable("Category", Object.entries(stats.byCategory)),
    ...breakdownTable("Severity", Object.entries(stats.bySeverity)),
    ...breakdownTable(
      "Month",
      stats.byMonth.map((m): [string, OutcomeCounts] => [m.month, m])
    )
  );
  if (result.truncated) {
    lines.push(
      "",
      "  ⚠️  PR limit reached; older PRs were not counted. Raise --limit to include them."
    );
  }
  if (result.platform === "azure") {
    lines.push(
      "",
      "  ℹ️  Azure DevOps can only filter by PR creation date, so older PRs that were active in",
      "     the window are not included."
    );
  }
  lines.push("", `  Results saved to ${file}`, "");
  return lines;
}
