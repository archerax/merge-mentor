import { join } from "node:path";

import { loadConfig, validateConfig } from "@merge-mentor/config/config.js";
import { collectLiveReviewStats } from "@merge-mentor/core/review/reviewStats.js";
import { initLogger } from "@merge-mentor/shared/logger.js";
import { consoleOutputWriter } from "@merge-mentor/shared/ports/index.js";
import {
  listUsageRecords,
  summarizeUsage,
  type UsageRecord,
} from "@merge-mentor/shared/reports/usageReport.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_STATS_PR_LIMIT,
  executeStatsCommand,
  formatLiveStats,
  formatUsageSummary,
  parseLimit,
  parseSince,
} from "./stats.js";

vi.mock("@merge-mentor/config/config.js", () => ({ loadConfig: vi.fn(), validateConfig: vi.fn() }));
vi.mock("@merge-mentor/core/review/reviewStats.js", () => ({ collectLiveReviewStats: vi.fn() }));
vi.mock("@merge-mentor/shared/logger.js", () => ({ initLogger: vi.fn() }));
vi.mock("@merge-mentor/shared/ports/index.js", () => ({
  consoleOutputWriter: { log: vi.fn(), error: vi.fn() },
}));

vi.mock("@merge-mentor/shared/reports/usageReport.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@merge-mentor/shared/reports/usageReport.js")>()),
  listUsageRecords: vi.fn(),
}));

const githubAdapter = vi.hoisted(() => vi.fn());
const azureAdapter = vi.hoisted(() => vi.fn());
vi.mock("@merge-mentor/platforms/github.js", () => ({ GitHubAdapter: githubAdapter }));
vi.mock("@merge-mentor/platforms/azure.js", () => ({ AzureDevOpsAdapter: azureAdapter }));

describe("parseSince", () => {
  const now = new Date("2026-03-31T00:00:00.000Z");

  it("parses relative day windows", () => {
    expect(parseSince("30d", now).toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("parses absolute dates", () => {
    expect(parseSince("2026-01-31", now).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("rejects invalid values", () => {
    expect(() => parseSince("soon", now)).toThrow(/date/);
  });

  it("rejects windows so large the date overflows", () => {
    expect(() => parseSince("99999999999999999999d", now)).toThrow(/date/);
  });
});

describe("parseLimit", () => {
  it("accepts positive integers", () => {
    expect(parseLimit("25")).toBe(25);
  });

  it.each(["0", "-1", "1.5", "abc"])("rejects %s", (value) => {
    expect(() => parseLimit(value)).toThrow(/positive integer/);
  });

  it("accepts the maximum and rejects anything above it", () => {
    expect(parseLimit("1000")).toBe(1000);
    expect(() => parseLimit("1001")).toThrow(/at most 1000/);
  });
});

describe("formatLiveStats", () => {
  const base = {
    platform: "github",
    project: "repo",
    prsScanned: 10,
    prsReviewed: 2,
    totalComments: 5,
    inlineComments: 4,
    generalComments: 1,
    prsFailed: 0,
    truncated: false,
    reviewedPullRequests: [
      {
        number: 7,
        title: "Fix bug",
        state: "open" as const,
        inlineComments: 4,
        generalComments: 1,
      },
    ],
  };

  it("prints totals and reviewed PRs", () => {
    const text = formatLiveStats(base, new Date("2026-03-01T00:00:00Z")).join("\n");
    expect(text).toContain("PRs scanned:      10");
    expect(text).toContain("PRs reviewed:     2");
    expect(text).toContain("Comments posted:  5 (4 inline, 1 general)");
    expect(text).toContain("#7 [open] Fix bug — 5 comments");
    expect(text).not.toContain("PR limit reached");
  });

  it("warns on truncation and unreadable PRs", () => {
    const text = formatLiveStats(
      { ...base, truncated: true, prsFailed: 2 },
      new Date("2026-03-01T00:00:00Z")
    ).join("\n");
    expect(text).toContain("PR limit reached");
    expect(text).toContain("PRs unreadable:   2");
  });
});

describe("executeStatsCommand", () => {
  const liveStats = {
    platform: "github",
    project: "repo",
    prsScanned: 1,
    prsReviewed: 1,
    totalComments: 2,
    inlineComments: 1,
    generalComments: 1,
    prsFailed: 0,
    truncated: false,
    reviewedPullRequests: [],
  };
  const now = new Date("2026-03-31T00:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.mocked(loadConfig).mockReturnValue({
      defaultPlatform: "github",
      tempPath: "/tmp/mm",
    } as ReturnType<typeof loadConfig>);
    vi.mocked(collectLiveReviewStats).mockResolvedValue(liveStats);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("scans the default 30-day window and limit on the configured platform", async () => {
    await executeStatsCommand({});

    expect(validateConfig).toHaveBeenCalledWith(expect.anything(), "github");
    expect(initLogger).toHaveBeenCalledWith("/tmp/mm");
    expect(githubAdapter).toHaveBeenCalledTimes(1);
    expect(collectLiveReviewStats).toHaveBeenCalledWith(expect.any(githubAdapter), {
      since: new Date("2026-03-01T00:00:00.000Z"),
      limit: DEFAULT_STATS_PR_LIMIT,
    });
    expect(consoleOutputWriter.log).toHaveBeenCalled();
  });

  it("uses the Azure adapter and explicit since/limit", async () => {
    const since = new Date("2026-01-01T00:00:00.000Z");

    await executeStatsCommand({ platform: "azure", since, limit: 5 });

    expect(validateConfig).toHaveBeenCalledWith(expect.anything(), "azure");
    expect(collectLiveReviewStats).toHaveBeenCalledWith(expect.any(azureAdapter), {
      since,
      limit: 5,
    });
  });

  it("prints JSON with an ISO since when --json is set", async () => {
    await executeStatsCommand({ json: true });

    const printed = JSON.parse(vi.mocked(consoleOutputWriter.log).mock.calls[0][0] as string);
    expect(printed).toMatchObject({ since: "2026-03-01T00:00:00.000Z", prsReviewed: 1 });
  });

  it("rejects an unsupported platform before querying", async () => {
    await expect(executeStatsCommand({ platform: "gitlab" })).rejects.toThrow(/Invalid platform/);
    expect(collectLiveReviewStats).not.toHaveBeenCalled();
  });

  it("propagates configuration errors", async () => {
    vi.mocked(validateConfig).mockImplementationOnce(() => {
      throw new Error("MM_GITHUB_TOKEN required");
    });

    await expect(executeStatsCommand({})).rejects.toThrow(/MM_GITHUB_TOKEN/);
  });
});

function usageRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    schemaVersion: 1,
    generatedAt: "2026-03-30T00:00:00.000Z",
    platform: "github",
    projectId: "o-r",
    prNumber: 1,
    prTitle: "PR",
    aiProvider: "copilot-sdk",
    tokenUsage: { inputTokens: 1000, outputTokens: 200, model: "gpt-4.1" },
    ...overrides,
  };
}

describe("formatUsageSummary", () => {
  const since = new Date("2026-03-01T00:00:00.000Z");
  const render = (records: UsageRecord[]): string =>
    formatUsageSummary(summarizeUsage(records), since, "/tmp/mm/reports").join("\n");

  it("explains when there are no usage records", () => {
    expect(render([])).toContain("No usage records found");
  });

  it("says usage was not reported rather than showing zeros", () => {
    const out = render([usageRecord({ tokenUsage: undefined })]);
    expect(out).toContain("Usage not reported by the AI provider");
    expect(out).not.toContain("Input tokens");
  });

  it("shows totals, averages and breakdowns, with unreported fields marked", () => {
    const out = render([
      usageRecord(),
      usageRecord({ prNumber: 2, tokenUsage: { inputTokens: 500, outputTokens: 100 } }),
    ]);
    expect(out).toContain("Total tokens:     1,800");
    expect(out).toContain("Avg per review:   900 tokens");
    expect(out).toContain("Avg per PR:       900 tokens");
    expect(out).toContain("Reasoning tokens: not reported");
    expect(out).toContain("Cost:             not reported");
    expect(out).toContain("gpt-4.1: 1,200 tokens over 1 run(s)");
  });

  it("converts provider-reported nano-AIU to credits and dollars", () => {
    const out = render([
      usageRecord({ tokenUsage: { inputTokens: 1, outputTokens: 1, nanoAiu: 2.5e9 } }),
    ]);
    expect(out).toContain("2.50 AI credits (~$0.0250)");
  });

  it("shows estimated dollars from list prices, including averages", () => {
    const out = render([
      usageRecord({ tokenUsage: { inputTokens: 10, outputTokens: 5, costUsd: 0.004 } }),
      usageRecord({
        prNumber: 2,
        tokenUsage: { inputTokens: 10, outputTokens: 5, costUsd: 0.002 },
      }),
    ]);
    expect(out).toContain("Cost:             $0.0060");
    expect(out).toContain("Avg cost/review:  $0.0030");
    expect(out).toContain("Avg cost/PR:      $0.0030");
  });

  it("flags partial and unreported reviews", () => {
    const out = render([
      usageRecord({ calls: { total: 3, reported: 1 } }),
      usageRecord({ prNumber: 2, tokenUsage: undefined }),
    ]);
    expect(out).toContain("1 review(s) are partial");
    expect(out).toContain("1 review(s) did not report usage and are excluded");
  });
});

describe("executeStatsCommand --usage", () => {
  const now = new Date("2026-03-31T00:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.mocked(loadConfig).mockReturnValue({ tempPath: "/tmp/mm" } as ReturnType<typeof loadConfig>);
    vi.mocked(listUsageRecords).mockResolvedValue([usageRecord()]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("reads local reports without querying the platform or requiring credentials", async () => {
    await executeStatsCommand({ usage: true });

    expect(listUsageRecords).toHaveBeenCalledWith({
      reportsDir: join("/tmp/mm", "reports"),
      since: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(collectLiveReviewStats).not.toHaveBeenCalled();
    expect(validateConfig).not.toHaveBeenCalled();
    expect(vi.mocked(consoleOutputWriter.log).mock.calls.flat().join("\n")).toContain(
      "Merge Mentor AI usage"
    );
  });

  it("honours --since and emits JSON", async () => {
    const since = new Date("2026-03-20T00:00:00.000Z");
    await executeStatsCommand({ usage: true, json: true, since });

    expect(vi.mocked(listUsageRecords).mock.calls[0][0]?.since).toEqual(since);
    const printed = JSON.parse(vi.mocked(consoleOutputWriter.log).mock.calls[0][0] as string);
    expect(printed).toMatchObject({ since: since.toISOString(), runs: 1, inputTokens: 1000 });
  });
});
