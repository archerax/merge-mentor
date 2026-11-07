import type { Config } from "@merge-mentor/config/config.js";
import type {
  BotThreadReader,
  PlatformAdapter,
  PullRequestLister,
  PullRequestSummary,
} from "@merge-mentor/domain/platform.js";

import { aggregateOutcomes } from "./aggregate.js";
import {
  emptyOutcomesFile,
  outcomesFilePath,
  readOutcomesFile,
  writeOutcomesFile,
} from "./cache.js";
import { toOutcomeComment } from "./classifier.js";
import type { OutcomesFile, OutcomeStats, ScannedPr } from "./types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_CONCURRENCY = 5;

/**
 * A PR closed this recently is rescanned even if it looks unchanged, because
 * resolving a thread after the merge is not known to change the PR's update time.
 */
const RECENTLY_CLOSED_DAYS = 14;

/** Save the results file after this many freshly scanned PRs, so an interrupted scan keeps its work. */
const SAVE_EVERY = 25;

/** The platform adapter capabilities a scan needs. */
export type OutcomeAdapter = PlatformAdapter & PullRequestLister & BotThreadReader;

/** Options for {@link scanOutcomes}. */
export interface ScanOutcomesOptions {
  /** Only scan PRs with activity at or after this instant. */
  readonly since: Date;
  /** Maximum number of PRs to scan. */
  readonly limit: number;
  /**
   * Identifies the repository the results belong to (see {@link outcomesProject}), so results
   * from another repository sharing the same temp path are never reused.
   */
  readonly project: string;
  /** Base path for temporary files; the results file lives under `outcomes/`. */
  readonly tempPath: string;
  /** Ignore the cache and rescan everything. */
  readonly refresh?: boolean;
  /** Scan only this PR (always rescanned). It must be inside the window. */
  readonly onlyPr?: number;
  /** Number of PRs fetched in parallel. Default: 5. */
  readonly concurrency?: number;
  /** Current time, injectable for tests. */
  readonly now?: Date;
  /** Called after each PR is processed. */
  readonly onProgress?: (done: number, total: number) => void;
}

/** Result of a scan. */
export interface ScanOutcomesResult {
  readonly platform: string;
  readonly project: string;
  readonly since: string;
  readonly stats: OutcomeStats;
  /** PRs rescanned from the platform in this run. */
  readonly prsFetched: number;
  /** PRs reused from the cache. */
  readonly prsFromCache: number;
  /** PRs whose threads could not be read; excluded from the stats. */
  readonly prsFailed: number;
  /** True when the PR limit was reached, so older PRs may not be counted. */
  readonly truncated: boolean;
  /** When the results file was last written. */
  readonly generatedAt: string;
}

/**
 * Whether a cached scan can be reused. Open PRs are always rescanned. A closed PR
 * is reused only if it has not changed and its recently-closed grace period had
 * ended before it was last scanned.
 */
export function isCacheFresh(
  cached: ScannedPr | undefined,
  pr: PullRequestSummary,
  graceDays: number = RECENTLY_CLOSED_DAYS
): boolean {
  if (!cached || cached.state !== "closed" || pr.state !== "closed") return false;
  if (cached.updatedAt !== pr.updatedAt) return false;
  const closedAt = Date.parse(pr.closedAt ?? pr.updatedAt);
  if (Number.isNaN(closedAt)) return false;
  return Date.parse(cached.scannedAt) >= closedAt + graceDays * MS_PER_DAY;
}

/**
 * Identifies the repository results belong to. GitHub's adapter reports only the repository
 * name, which is not unique across owners, so the owner is included.
 *
 * @param config - Loaded configuration
 * @param platform - Platform being scanned
 */
export function outcomesProject(config: Config, platform: "github" | "azure"): string {
  return platform === "github"
    ? `${config.github.owner}/${config.github.repo}`
    : `${config.azure.org}/${config.azure.project}/${config.azure.repo}`;
}

/** Cached results for display, without contacting the platform. */
export interface CachedOutcomes {
  readonly platform: string;
  readonly project: string;
  readonly since: string;
  readonly stats: OutcomeStats;
  /** When the results file was last written. */
  readonly generatedAt: string;
}

/**
 * Reads the saved results and collates the PRs inside the window. Never contacts the platform.
 *
 * @param tempPath - Base path for temporary files
 * @param platform - Platform of the repository
 * @param project - Repository identifier from {@link outcomesProject}
 * @param since - Start of the window
 * @returns The collated results, or `undefined` when the repository has not been scanned
 */
export async function loadCachedOutcomes(
  tempPath: string,
  platform: string,
  project: string,
  since: Date
): Promise<CachedOutcomes | undefined> {
  const file = await readOutcomesFile(outcomesFilePath(tempPath), platform, project);
  if (!file) return undefined;
  const inWindow = Object.values(file.prs).filter(
    (pr) => Date.parse(pr.updatedAt) >= since.getTime()
  );
  return {
    platform,
    project,
    since: since.toISOString(),
    stats: aggregateOutcomes(inWindow),
    generatedAt: file.generatedAt,
  };
}

/**
 * Scans the repository's PRs and collates what became of the review threads
 * Merge Mentor started. Only reads from the platform; it writes the results
 * file under the temp path, which doubles as the scan cache.
 *
 * @param adapter - Platform adapter for the repository
 * @param options - Window, limit, cache location and behaviour
 * @throws When every PR that had to be fetched failed (for example an expired token)
 */
export async function scanOutcomes(
  adapter: OutcomeAdapter,
  options: ScanOutcomesOptions
): Promise<ScanOutcomesResult> {
  const now = options.now ?? new Date();
  const platform = adapter.getPlatformName();
  const project = options.project;
  const filePath = outcomesFilePath(options.tempPath);

  const existing = options.refresh
    ? undefined
    : await readOutcomesFile(filePath, platform, project);
  const prs: Record<string, ScannedPr> = { ...existing?.prs };

  // Ask for one extra PR so hitting the limit exactly is not mistaken for truncation.
  const listed = await adapter.listPullRequests({ since: options.since, limit: options.limit + 1 });
  const truncated = listed.length > options.limit;
  const pulls = listed
    .slice(0, options.limit)
    .filter((pr) => options.onlyPr === undefined || pr.number === options.onlyPr);

  const pending = pulls.filter(
    (pr) => options.onlyPr !== undefined || !isCacheFresh(prs[String(pr.number)], pr)
  );
  const prsFromCache = pulls.length - pending.length;

  const failed = new Set<number>();
  let firstError: unknown;
  let next = 0;
  let done = 0;
  let saving: Promise<void> = Promise.resolve();

  const snapshot = (): OutcomesFile => ({
    ...(existing ?? emptyOutcomesFile(platform, project, now)),
    platform,
    project,
    generatedAt: now.toISOString(),
    prs: { ...prs },
  });
  const save = (): Promise<void> => {
    saving = saving.then(() => writeOutcomesFile(filePath, snapshot()));
    return saving;
  };

  const worker = async (): Promise<void> => {
    while (next < pending.length) {
      const pr = pending[next];
      next += 1;
      try {
        const threads = await adapter.getBotThreadStates(pr.number);
        prs[String(pr.number)] = {
          updatedAt: pr.updatedAt,
          state: pr.state,
          ...(pr.closedAt ? { closedAt: pr.closedAt } : {}),
          scannedAt: now.toISOString(),
          comments: threads.map((thread) => toOutcomeComment(thread, pr)),
        };
      } catch (error) {
        firstError ??= error;
        failed.add(pr.number);
      }
      done += 1;
      options.onProgress?.(done, pending.length);
      if (done % SAVE_EVERY === 0) await save();
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, pending.length) },
      worker
    )
  );

  if (pending.length > 0 && failed.size === pending.length && prsFromCache === 0) {
    throw new Error(
      `Could not read comments on any of the ${pending.length} PRs: ${(firstError as Error)?.message ?? "unknown error"}`
    );
  }

  if (pending.length > 0) await save();

  const scanned = pulls.flatMap((pr) => {
    const entry = failed.has(pr.number) ? undefined : prs[String(pr.number)];
    return entry ? [entry] : [];
  });

  return {
    platform,
    project,
    since: options.since.toISOString(),
    stats: aggregateOutcomes(scanned),
    prsFetched: pending.length - failed.size,
    prsFromCache,
    prsFailed: failed.size,
    truncated,
    generatedAt:
      pending.length > 0 ? now.toISOString() : (existing?.generatedAt ?? now.toISOString()),
  };
}
