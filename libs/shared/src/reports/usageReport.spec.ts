import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ReportFileSystem } from "./reportReader.js";
import {
  isUsageRecordName,
  listUsageRecords,
  parseUsageRecord,
  summarizeUsage,
  USAGE_RECORD_SCHEMA_VERSION,
  type UsageRecord,
  usageCompleteness,
  usageRecordFileName,
} from "./usageReport.js";

const DIR = path.join("/tmp", "reports");

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    schemaVersion: USAGE_RECORD_SCHEMA_VERSION,
    generatedAt: "2026-10-01T10:00:00.000Z",
    platform: "github",
    projectId: "owner-repo",
    prNumber: 1,
    prTitle: "A PR",
    aiProvider: "copilot-sdk",
    tokenUsage: { inputTokens: 100, outputTokens: 50, model: "gpt-4.1" },
    calls: { total: 2, reported: 2 },
    ...overrides,
  };
}

function fakeFs(files: Record<string, string>): ReportFileSystem {
  return {
    readFile: async (p) => {
      const content = files[p];
      if (content === undefined) throw new Error("ENOENT");
      return content;
    },
    readdir: async (dir) => {
      if (dir !== DIR) throw new Error("ENOENT");
      return Object.keys(files).map((p) => ({ name: path.basename(p), isFile: () => true }));
    },
    stat: async () => ({ size: 0, mtime: new Date(0) }),
  };
}

describe("usageRecordFileName", () => {
  it("is timestamped, filesystem-safe, and recognised as a usage record", () => {
    const name = usageRecordFileName("Github-repo-PR1", new Date("2026-10-01T10:00:00.123Z"));
    expect(name).toBe("Github-repo-PR1-review-usage-2026-10-01T10-00-00-123Z.json");
    expect(isUsageRecordName(name)).toBe(true);
    expect(isUsageRecordName("Github-repo-PR1-review-profile-report.md")).toBe(false);
    expect(isUsageRecordName("prd-1-review-report.json")).toBe(false);
  });
});

describe("parseUsageRecord", () => {
  it("round-trips a valid record", () => {
    const r = record({
      tokenUsage: {
        inputTokens: 1,
        outputTokens: 2,
        reasoningTokens: 3,
        cachedTokens: 4,
        nanoAiu: 5,
        model: "m",
      },
    });
    expect(parseUsageRecord(JSON.stringify(r))).toEqual(r);
  });

  it("rejects corrupt json, wrong schema versions, and missing fields", () => {
    expect(parseUsageRecord("{nope")).toBeUndefined();
    expect(parseUsageRecord("null")).toBeUndefined();
    expect(parseUsageRecord(JSON.stringify({ ...record(), schemaVersion: 99 }))).toBeUndefined();
    expect(parseUsageRecord(JSON.stringify({ ...record(), prNumber: "1" }))).toBeUndefined();
    expect(parseUsageRecord(JSON.stringify({ ...record(), generatedAt: "nope" }))).toBeUndefined();
  });

  it("drops malformed tokenUsage so the run reads as not reported", () => {
    const parsed = parseUsageRecord(
      JSON.stringify({ ...record(), tokenUsage: { inputTokens: "x", outputTokens: 1 } })
    );
    expect(parsed?.tokenUsage).toBeUndefined();
  });
});

describe("usageCompleteness", () => {
  it("distinguishes complete, partial and not-reported runs", () => {
    expect(usageCompleteness(record())).toBe("complete");
    expect(usageCompleteness(record({ calls: { total: 3, reported: 2 } }))).toBe("partial");
    expect(usageCompleteness(record({ tokenUsage: undefined }))).toBe("not-reported");
    expect(usageCompleteness(record({ calls: undefined }))).toBe("complete");
  });
});

describe("listUsageRecords", () => {
  it("returns [] for a missing directory", async () => {
    expect(await listUsageRecords({ reportsDir: "/nope", fs: fakeFs({}) })).toEqual([]);
  });

  it("skips corrupt, unrelated and unreadable files and sorts oldest first", async () => {
    const newer = record({ generatedAt: "2026-10-02T00:00:00.000Z", prNumber: 2 });
    const older = record({ generatedAt: "2026-10-01T00:00:00.000Z", prNumber: 1 });
    const fs = fakeFs({
      [path.join(DIR, "a-review-usage-2.json")]: JSON.stringify(newer),
      [path.join(DIR, "a-review-usage-1.json")]: JSON.stringify(older),
      [path.join(DIR, "a-review-usage-bad.json")]: "{corrupt",
      [path.join(DIR, "a-review-profile-report.md")]: "# report",
    });
    const records = await listUsageRecords({ reportsDir: DIR, fs });
    expect(records.map((r) => r.prNumber)).toEqual([1, 2]);
  });

  it("filters by since", async () => {
    const fs = fakeFs({
      [path.join(DIR, "a-review-usage-1.json")]: JSON.stringify(
        record({ generatedAt: "2026-09-01T00:00:00.000Z", prNumber: 1 })
      ),
      [path.join(DIR, "a-review-usage-2.json")]: JSON.stringify(
        record({ generatedAt: "2026-10-05T00:00:00.000Z", prNumber: 2 })
      ),
    });
    const records = await listUsageRecords({
      reportsDir: DIR,
      fs,
      since: new Date("2026-10-01T00:00:00.000Z"),
    });
    expect(records.map((r) => r.prNumber)).toEqual([2]);
  });
});

describe("summarizeUsage", () => {
  it("totals reported runs, counts re-reviews, and groups by model and provider", () => {
    const summary = summarizeUsage([
      record({
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
          reasoningTokens: 10,
          nanoAiu: 2e9,
          model: "a",
        },
      }),
      record({ tokenUsage: { inputTokens: 10, outputTokens: 5, model: "a" } }),
      record({
        prNumber: 2,
        aiProvider: "opencode-sdk",
        tokenUsage: { inputTokens: 1, outputTokens: 1, model: "b" },
        calls: { total: 3, reported: 1 },
      }),
    ]);
    expect(summary).toMatchObject({
      runs: 3,
      prs: 2,
      reportedPrs: 2,
      inputTokens: 111,
      outputTokens: 56,
      reasoningTokens: 10,
      nanoAiu: 2e9,
      completeRuns: 2,
      partialRuns: 1,
      notReportedRuns: 0,
    });
    expect(summary.byModel.map((g) => [g.key, g.runs])).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
    expect(summary.byProvider.map((g) => g.key).toSorted()).toEqual([
      "copilot-sdk",
      "opencode-sdk",
    ]);
  });

  it("counts not-reported runs without adding zero usage, and leaves nanoAiu undefined", () => {
    const summary = summarizeUsage([record({ tokenUsage: undefined, calls: undefined })]);
    expect(summary.runs).toBe(0);
    expect(summary.prs).toBe(1);
    expect(summary.reportedPrs).toBe(0);
    expect(summary.notReportedRuns).toBe(1);
    expect(summary.nanoAiu).toBeUndefined();
  });

  it("leaves reasoning, cached and cost undefined when no run reported them", () => {
    const summary = summarizeUsage([record()]);
    expect(summary.reasoningTokens).toBeUndefined();
    expect(summary.cachedTokens).toBeUndefined();
    expect(summary.nanoAiu).toBeUndefined();
    expect(summary.byModel[0].cachedTokens).toBeUndefined();
  });
});
