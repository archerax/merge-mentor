import { loadConfig, validateConfig } from "@merge-mentor/config/config.js";
import {
  type CachedOutcomes,
  loadCachedOutcomes,
  outcomesProject,
  scanOutcomes,
} from "@merge-mentor/core/review/outcomes/scanner.js";
import type { Platform } from "@merge-mentor/domain/platform.js";
import { AzureDevOpsAdapter } from "@merge-mentor/platforms/azure.js";
import { GitHubAdapter } from "@merge-mentor/platforms/github.js";
import { initLogger } from "@merge-mentor/shared/logger.js";

import { refreshEnv, resolveTempPath } from "./env.server.js";

const WINDOW_MONTHS = 12;
const MAX_PRS = 1000;

/** State of the background scan, shared by every request to this server. */
export interface OutcomesScanState {
  readonly running: boolean;
  /** PRs processed so far in the running scan. */
  readonly done: number;
  /** PRs the running scan has to fetch. */
  readonly total: number;
  /** Message from the last scan if it failed. */
  readonly error?: string;
  /** Notes from the last finished scan. */
  readonly lastRun?: {
    readonly prsFetched: number;
    readonly prsFromCache: number;
    readonly prsFailed: number;
    readonly truncated: boolean;
  };
}

/** What the outcomes page shows. */
export interface OutcomesView {
  /** Saved results, or undefined when the repository has not been scanned yet. */
  readonly cached?: CachedOutcomes;
  readonly scan: OutcomesScanState;
}

let scan: OutcomesScanState = { running: false, done: 0, total: 0 };

function windowStart(now: Date = new Date()): Date {
  const start = new Date(now.getTime());
  start.setUTCMonth(start.getUTCMonth() - WINDOW_MONTHS);
  return start;
}

function resolveSettings() {
  refreshEnv();
  const config = loadConfig({ tempPath: resolveTempPath() });
  const platform = config.defaultPlatform as Platform;
  if (platform !== "github" && platform !== "azure") {
    throw new Error(`Invalid platform "${platform}". Must be "github" or "azure".`);
  }
  validateConfig(config, platform);
  return { config, platform, project: outcomesProject(config, platform) };
}

/**
 * Returns the saved outcome results and the state of any running scan. Never
 * contacts the platform, so opening the page is cheap.
 */
export async function loadOutcomes(): Promise<OutcomesView> {
  const { config, platform, project } = resolveSettings();
  const cached = await loadCachedOutcomes(config.tempPath, platform, project, windowStart());
  return { cached, scan };
}

/**
 * Starts a scan of the last 12 months in the background. Only one scan runs at a time;
 * asking again while one is running changes nothing.
 *
 * @param refresh - Ignore saved results and rescan every PR
 * @returns The scan state right after starting
 */
export function startOutcomesScan(refresh: boolean): OutcomesScanState {
  if (scan.running) return scan;
  const { config, platform, project } = resolveSettings();

  // initLogger resets the process-wide logger, which a concurrent review also uses.
  initLogger(config.tempPath);
  const adapter =
    platform === "github" ? new GitHubAdapter(config) : new AzureDevOpsAdapter(config);

  scan = { running: true, done: 0, total: 0 };
  void scanOutcomes(adapter, {
    since: windowStart(),
    limit: MAX_PRS,
    project,
    tempPath: config.tempPath,
    refresh,
    onProgress: (done, total) => {
      scan = { running: true, done, total };
    },
  }).then(
    (result) => {
      scan = {
        running: false,
        done: 0,
        total: 0,
        lastRun: {
          prsFetched: result.prsFetched,
          prsFromCache: result.prsFromCache,
          prsFailed: result.prsFailed,
          truncated: result.truncated,
        },
      };
    },
    (error: unknown) => {
      scan = { running: false, done: 0, total: 0, error: (error as Error).message };
    }
  );
  return scan;
}
