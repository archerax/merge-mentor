import { loadConfig, validateConfig } from "@merge-mentor/config/config.js";
import {
  type ScanOutcomesResult,
  scanOutcomes,
} from "@merge-mentor/core/review/outcomes/scanner.js";
import { consoleOutputWriter } from "@merge-mentor/shared/ports/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_OUTCOMES_PR_LIMIT,
  executeOutcomesCommand,
  formatOutcomes,
  parseOutcomesSince,
  parsePrNumber,
} from "./outcomes.js";

vi.mock("@merge-mentor/config/config.js", () => ({ loadConfig: vi.fn(), validateConfig: vi.fn() }));
vi.mock("@merge-mentor/core/review/outcomes/scanner.js", () => ({
  scanOutcomes: vi.fn(),
  outcomesProject: vi.fn(() => "o/r"),
}));
vi.mock("@merge-mentor/shared/logger.js", () => ({ initLogger: vi.fn() }));
vi.mock("@merge-mentor/shared/ports/index.js", () => ({
  consoleOutputWriter: { log: vi.fn(), error: vi.fn() },
}));
const githubAdapter = vi.hoisted(() => vi.fn());
const azureAdapter = vi.hoisted(() => vi.fn());
vi.mock("@merge-mentor/platforms/github.js", () => ({ GitHubAdapter: githubAdapter }));
vi.mock("@merge-mentor/platforms/azure.js", () => ({ AzureDevOpsAdapter: azureAdapter }));

describe("parseOutcomesSince", () => {
  const now = new Date("2026-06-15T00:00:00.000Z");

  it.each([
    ["30d", "2026-05-16T00:00:00.000Z"],
    ["6m", "2025-12-15T00:00:00.000Z"],
    ["12m", "2025-06-15T00:00:00.000Z"],
    ["1y", "2025-06-15T00:00:00.000Z"],
  ])("parses the window %s", (value, expected) => {
    expect(parseOutcomesSince(value, now).toISOString()).toBe(expected);
  });

  it("parses absolute dates", () => {
    expect(parseOutcomesSince("2026-01-31", now).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("rejects invalid values and overflowing windows", () => {
    expect(() => parseOutcomesSince("soon", now)).toThrow(/window/);
    expect(() => parseOutcomesSince("99999999999999999999d", now)).toThrow(/window/);
  });
});

describe("parsePrNumber", () => {
  it("accepts positive integers only", () => {
    expect(parsePrNumber("42")).toBe(42);
    for (const bad of ["0", "-1", "1.5", "x"]) {
      expect(() => parsePrNumber(bad)).toThrow(/positive PR number/);
    }
  });
});

const counts = {
  total: 4,
  resolved: 2,
  openMerged: 1,
  openClosed: 0,
  open: 1,
  resolutionRate: 2 / 3,
};
const result: ScanOutcomesResult = {
  platform: "github",
  project: "o/r",
  since: "2025-06-15T00:00:00.000Z",
  stats: {
    ...counts,
    prsScanned: 5,
    prsWithComments: 2,
    byCategory: { bug: counts },
    bySeverity: { high: counts },
    byMonth: [{ month: "2026-01", ...counts }],
  },
  prsFetched: 3,
  prsFromCache: 2,
  prsFailed: 0,
  truncated: false,
  generatedAt: "2026-06-15T00:00:00.000Z",
};

describe("formatOutcomes", () => {
  it("prints totals, breakdowns and the results file", () => {
    const text = formatOutcomes(result, "/tmp/mm/outcomes/outcomes.json").join("\n");
    expect(text).toContain("PRs scanned:          5 (3 fetched, 2 from cache)");
    expect(text).toContain("Resolved:           2");
    expect(text).toContain("Resolution rate:      67%");
    expect(text).toMatch(/Category\s+Total/);
    expect(text).toMatch(/2026-01\s+4\s+2\s+1\s+1\s+67%/);
    expect(text).toContain("/tmp/mm/outcomes/outcomes.json");
    expect(text).not.toContain("PR limit reached");
    expect(text).not.toContain("Azure");
  });

  it("shows n/a when nothing has reached an outcome", () => {
    const empty = {
      ...counts,
      total: 1,
      resolved: 0,
      openMerged: 0,
      open: 1,
      resolutionRate: null,
    };
    const text = formatOutcomes({ ...result, stats: { ...result.stats, ...empty } }, "f").join(
      "\n"
    );
    expect(text).toContain("Resolution rate:      n/a");
  });

  it("warns about truncation, unreadable PRs and the Azure date caveat", () => {
    const text = formatOutcomes(
      { ...result, platform: "azure", truncated: true, prsFailed: 2 },
      "f"
    ).join("\n");
    expect(text).toContain("PR limit reached");
    expect(text).toContain("PRs unreadable:       2");
    expect(text).toContain("creation date");
  });
});

describe("executeOutcomesCommand", () => {
  const now = new Date("2026-06-15T00:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.mocked(loadConfig).mockReturnValue({
      defaultPlatform: "github",
      tempPath: "/tmp/mm",
    } as ReturnType<typeof loadConfig>);
    vi.mocked(scanOutcomes).mockResolvedValue(result);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("scans the last 12 months with the default limit and prints a summary", async () => {
    await executeOutcomesCommand({});

    expect(validateConfig).toHaveBeenCalledWith(expect.anything(), "github");
    expect(scanOutcomes).toHaveBeenCalledWith(
      expect.any(githubAdapter),
      expect.objectContaining({
        since: new Date("2025-06-15T00:00:00.000Z"),
        limit: DEFAULT_OUTCOMES_PR_LIMIT,
        tempPath: "/tmp/mm",
      })
    );
    expect(vi.mocked(consoleOutputWriter.log).mock.calls.flat().join("\n")).toContain(
      "Merge Mentor outcomes for o/r"
    );
  });

  it("passes refresh, single-PR and azure options through", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      defaultPlatform: "azure",
      tempPath: "/tmp/mm",
    } as ReturnType<typeof loadConfig>);
    await executeOutcomesCommand({ refresh: true, pr: 7, limit: 50 });

    expect(scanOutcomes).toHaveBeenCalledWith(
      expect.any(azureAdapter),
      expect.objectContaining({ refresh: true, onlyPr: 7, limit: 50 })
    );
  });

  it("prints JSON without progress output", async () => {
    await executeOutcomesCommand({ json: true });

    expect(JSON.parse(vi.mocked(consoleOutputWriter.log).mock.calls[0][0])).toMatchObject({
      project: "o/r",
    });
    expect(vi.mocked(scanOutcomes).mock.calls[0][1].onProgress).toBeUndefined();
  });

  it("rejects an invalid platform", async () => {
    await expect(executeOutcomesCommand({ platform: "gitlab" })).rejects.toThrow(
      /Invalid platform/
    );
  });
});
