import path from "node:path";

import type { TokenUsage } from "@merge-mentor/domain/ai.js";

import { nodeFs } from "../ports/index.js";
import { sumOptional } from "../utils/tokenUsage.js";
import type { ReportFileSystem } from "./reportReader.js";

/**
 * Per-run usage records for PR reviews.
 *
 * Each PR review writes a small JSON file next to its markdown report
 * (`<prIdentifier>-review-usage-<timestamp>.json`). The filename carries a
 * timestamp so re-reviews of the same PR are all counted. Readers tolerate
 * missing and corrupt files so usage reporting never breaks on old data.
 */

/** Current on-disk schema version of {@link UsageRecord}. */
export const USAGE_RECORD_SCHEMA_VERSION = 1;

/** AI calls made during a run, and how many of them reported usage. */
interface UsageCallCoverage {
  readonly total: number;
  readonly reported: number;
}

/** Usage persisted for one PR review run. */
export interface UsageRecord {
  readonly schemaVersion: typeof USAGE_RECORD_SCHEMA_VERSION;
  /** ISO timestamp of when the run finished. */
  readonly generatedAt: string;
  readonly platform: string;
  readonly projectId: string;
  readonly prNumber: number;
  readonly prTitle: string;
  readonly aiProvider: string;
  /** Aggregated usage; absent when no AI call reported any ("not reported"). */
  readonly tokenUsage?: TokenUsage;
  /** Call coverage, used to flag runs where only some calls reported usage. */
  readonly calls?: UsageCallCoverage;
}

const USAGE_FILE_MARKER = "-review-usage-";
const USAGE_FILE_SUFFIX = ".json";

/**
 * Builds the file name for a run's usage record.
 *
 * @param prIdentifier - Identifier from `generatePRIdentifier`
 * @param generatedAt - Run completion time
 */
export function usageRecordFileName(prIdentifier: string, generatedAt: Date): string {
  const stamp = generatedAt.toISOString().replace(/[:.]/g, "-");
  return `${prIdentifier}${USAGE_FILE_MARKER}${stamp}${USAGE_FILE_SUFFIX}`;
}

/** Reports whether a file name looks like a usage record. */
export function isUsageRecordName(name: string): boolean {
  return name.includes(USAGE_FILE_MARKER) && name.endsWith(USAGE_FILE_SUFFIX);
}

/** Classifies how completely a run reported usage. */
export type UsageCompleteness = "complete" | "partial" | "not-reported";

/**
 * Determines whether a record reported usage fully, partially, or not at all.
 */
export function usageCompleteness(record: UsageRecord): UsageCompleteness {
  if (!record.tokenUsage) return "not-reported";
  const calls = record.calls;
  return calls && calls.reported < calls.total ? "partial" : "complete";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return isFiniteNumber(value) ? value : undefined;
}

function parseTokenUsage(value: unknown): TokenUsage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (!isFiniteNumber(raw.inputTokens) || !isFiniteNumber(raw.outputTokens)) return undefined;
  return {
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    ...(optionalNumber(raw, "reasoningTokens") !== undefined
      ? { reasoningTokens: raw.reasoningTokens as number }
      : {}),
    ...(optionalNumber(raw, "cachedTokens") !== undefined
      ? { cachedTokens: raw.cachedTokens as number }
      : {}),
    ...(optionalNumber(raw, "premiumRequests") !== undefined
      ? { premiumRequests: raw.premiumRequests as number }
      : {}),
    ...(optionalNumber(raw, "nanoAiu") !== undefined ? { nanoAiu: raw.nanoAiu as number } : {}),
    ...(typeof raw.model === "string" ? { model: raw.model } : {}),
    ...(optionalNumber(raw, "durationApiSeconds") !== undefined
      ? { durationApiSeconds: raw.durationApiSeconds as number }
      : {}),
    ...(optionalNumber(raw, "durationWallSeconds") !== undefined
      ? { durationWallSeconds: raw.durationWallSeconds as number }
      : {}),
  };
}

function parseCalls(value: unknown): UsageCallCoverage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  return isFiniteNumber(raw.total) && isFiniteNumber(raw.reported)
    ? { total: raw.total, reported: raw.reported }
    : undefined;
}

/**
 * Parses and validates the JSON text of a usage record.
 *
 * @returns The record, or `undefined` for corrupt or unsupported content
 */
export function parseUsageRecord(text: string): UsageRecord | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (
    r.schemaVersion !== USAGE_RECORD_SCHEMA_VERSION ||
    typeof r.generatedAt !== "string" ||
    Number.isNaN(Date.parse(r.generatedAt)) ||
    typeof r.platform !== "string" ||
    typeof r.projectId !== "string" ||
    !isFiniteNumber(r.prNumber) ||
    typeof r.prTitle !== "string" ||
    typeof r.aiProvider !== "string"
  ) {
    return undefined;
  }
  const tokenUsage = parseTokenUsage(r.tokenUsage);
  const calls = parseCalls(r.calls);
  return {
    schemaVersion: USAGE_RECORD_SCHEMA_VERSION,
    generatedAt: r.generatedAt,
    platform: r.platform,
    projectId: r.projectId,
    prNumber: r.prNumber,
    prTitle: r.prTitle,
    aiProvider: r.aiProvider,
    ...(tokenUsage ? { tokenUsage } : {}),
    ...(calls ? { calls } : {}),
  };
}

/** Options for {@link listUsageRecords}. */
export interface ListUsageRecordsOptions {
  /** Directory containing report files. Defaults to `.mergementor/reports` in cwd. */
  readonly reportsDir?: string;
  /** Filesystem implementation. Defaults to `nodeFs`. */
  readonly fs?: ReportFileSystem;
  /** Only include records generated at or after this time. */
  readonly since?: Date;
}

/**
 * Reads all usage records from the reports directory, oldest first.
 *
 * A missing directory yields an empty list; unreadable or corrupt files are skipped.
 */
export async function listUsageRecords(
  options: ListUsageRecordsOptions = {}
): Promise<UsageRecord[]> {
  const fs = options.fs ?? nodeFs;
  const reportsDir = options.reportsDir ?? path.join(process.cwd(), ".mergementor", "reports");

  let dirents: ReadonlyArray<{ name: string; isFile(): boolean }>;
  try {
    dirents = await fs.readdir(reportsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const records: UsageRecord[] = [];
  for (const dirent of dirents) {
    if (!dirent.isFile() || !isUsageRecordName(dirent.name)) continue;
    let text: string;
    try {
      text = await fs.readFile(path.join(reportsDir, dirent.name), "utf-8");
    } catch {
      continue;
    }
    const record = parseUsageRecord(text);
    if (!record) continue;
    if (options.since && Date.parse(record.generatedAt) < options.since.getTime()) continue;
    records.push(record);
  }
  return records.toSorted((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
}

/** Aggregated usage for a group of runs. */
export interface UsageGroupTotals {
  readonly runs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Undefined when no run in the group reported reasoning tokens. */
  readonly reasoningTokens?: number;
  /** Undefined when no run in the group reported cached tokens. */
  readonly cachedTokens?: number;
  /** Sum of provider-reported cost; undefined when no run in the group reported one. */
  readonly nanoAiu?: number;
}

/** Aggregated usage over a window of runs. */
export interface UsageSummary extends UsageGroupTotals {
  /** Distinct PRs (platform + project + number) with at least one run. */
  readonly prs: number;
  /** Distinct PRs with at least one run that reported usage. */
  readonly reportedPrs: number;
  readonly completeRuns: number;
  readonly partialRuns: number;
  readonly notReportedRuns: number;
  /** Per model, for runs that reported usage. */
  readonly byModel: ReadonlyArray<UsageGroupTotals & { readonly key: string }>;
  /** Per AI provider, for runs that reported usage. */
  readonly byProvider: ReadonlyArray<UsageGroupTotals & { readonly key: string }>;
}

interface MutableTotals {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | undefined;
  cachedTokens: number | undefined;
  nanoAiu: number | undefined;
}

function emptyTotals(): MutableTotals {
  return {
    runs: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: undefined,
    cachedTokens: undefined,
    nanoAiu: undefined,
  };
}

function totalsFor(groups: Map<string, MutableTotals>, key: string): MutableTotals {
  let totals = groups.get(key);
  if (!totals) {
    totals = emptyTotals();
    groups.set(key, totals);
  }
  return totals;
}

function addUsage(totals: MutableTotals, usage: TokenUsage): void {
  totals.runs += 1;
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
  totals.reasoningTokens = sumOptional(totals.reasoningTokens, usage.reasoningTokens);
  totals.cachedTokens = sumOptional(totals.cachedTokens, usage.cachedTokens);
  totals.nanoAiu = sumOptional(totals.nanoAiu, usage.nanoAiu);
}

function optionalTotals(
  totals: MutableTotals
): Pick<UsageGroupTotals, "reasoningTokens" | "cachedTokens" | "nanoAiu"> {
  return {
    ...(totals.reasoningTokens !== undefined ? { reasoningTokens: totals.reasoningTokens } : {}),
    ...(totals.cachedTokens !== undefined ? { cachedTokens: totals.cachedTokens } : {}),
    ...(totals.nanoAiu !== undefined ? { nanoAiu: totals.nanoAiu } : {}),
  };
}

function groupToList(
  groups: Map<string, MutableTotals>
): Array<UsageGroupTotals & { key: string }> {
  return [...groups.entries()]
    .map(([key, totals]) => ({
      key,
      runs: totals.runs,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      ...optionalTotals(totals),
    }))
    .toSorted((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
}

/**
 * Aggregates usage records. Runs that did not report usage count toward
 * `notReportedRuns` and contribute no tokens (never zero-valued usage).
 */
export function summarizeUsage(records: readonly UsageRecord[]): UsageSummary {
  const totals = emptyTotals();
  const byModel = new Map<string, MutableTotals>();
  const byProvider = new Map<string, MutableTotals>();
  const prKeys = new Set<string>();
  const reportedPrKeys = new Set<string>();
  let completeRuns = 0;
  let partialRuns = 0;
  let notReportedRuns = 0;

  for (const record of records) {
    const prKey = `${record.platform}/${record.projectId}/${record.prNumber}`;
    prKeys.add(prKey);
    const completeness = usageCompleteness(record);
    if (completeness === "not-reported" || !record.tokenUsage) {
      notReportedRuns += 1;
      continue;
    }
    reportedPrKeys.add(prKey);
    if (completeness === "partial") partialRuns += 1;
    else completeRuns += 1;

    addUsage(totals, record.tokenUsage);
    addUsage(totalsFor(byModel, record.tokenUsage.model ?? "unknown"), record.tokenUsage);
    addUsage(totalsFor(byProvider, record.aiProvider), record.tokenUsage);
  }

  return {
    runs: totals.runs,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    ...optionalTotals(totals),
    prs: prKeys.size,
    reportedPrs: reportedPrKeys.size,
    completeRuns,
    partialRuns,
    notReportedRuns,
    byModel: groupToList(byModel),
    byProvider: groupToList(byProvider),
  };
}
