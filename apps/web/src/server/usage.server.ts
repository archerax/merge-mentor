import path from "node:path";

import {
  listUsageRecords,
  summarizeUsage,
  type UsageSummary,
} from "@merge-mentor/shared/reports/usageReport.js";

import { resolveTempPath } from "./env.server.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Largest accepted window in days. */
const MAX_DAYS = 365;

/**
 * Summarizes AI usage from the usage records stored next to local PR review reports.
 *
 * Reads local files only, so it works without platform credentials.
 *
 * @param days - Only include reviews from the last this many days (1-365)
 * @returns Aggregated usage; unreported fields stay undefined rather than zero
 */
export async function loadUsageSummary(days: number): Promise<UsageSummary> {
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new Error(`days must be an integer between 1 and ${MAX_DAYS}.`);
  }
  const since = new Date(Date.now() - days * MS_PER_DAY);
  const reportsDir = path.join(resolveTempPath(), "reports");
  return summarizeUsage(await listUsageRecords({ reportsDir, since }));
}
