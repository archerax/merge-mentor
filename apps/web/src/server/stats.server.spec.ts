import { loadConfig, validateConfig } from "@merge-mentor/config/config.js";
import { collectLiveReviewStats } from "@merge-mentor/core/review/reviewStats.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadLiveStats } from "./stats.server.js";

vi.mock("@merge-mentor/config/config.js", () => ({ loadConfig: vi.fn(), validateConfig: vi.fn() }));
vi.mock("@merge-mentor/core/review/reviewStats.js", () => ({ collectLiveReviewStats: vi.fn() }));
vi.mock("@merge-mentor/shared/logger.js", () => ({ initLogger: vi.fn() }));
vi.mock("./env.server.js", () => ({ refreshEnv: vi.fn() }));

const githubAdapter = vi.hoisted(() =>
  vi.fn(function (this: { getProjectIdentifier: () => string }) {
    this.getProjectIdentifier = () => "repo";
  })
);
const azureAdapter = vi.hoisted(() =>
  vi.fn(function (this: { getProjectIdentifier: () => string }) {
    this.getProjectIdentifier = () => "org/project/repo";
  })
);
vi.mock("@merge-mentor/platforms/github.js", () => ({ GitHubAdapter: githubAdapter }));
vi.mock("@merge-mentor/platforms/azure.js", () => ({ AzureDevOpsAdapter: azureAdapter }));

const stats = {
  platform: "github",
  project: "repo",
  prsScanned: 0,
  prsReviewed: 0,
  totalComments: 0,
  inlineComments: 0,
  generalComments: 0,
  prsFailed: 0,
  truncated: false,
  reviewedPullRequests: [],
};

function mockPlatform(defaultPlatform: string): void {
  vi.mocked(loadConfig).mockReturnValue({ defaultPlatform, tempPath: "/tmp/mm" } as ReturnType<
    typeof loadConfig
  >);
}

describe("loadLiveStats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-31T00:00:00.000Z"));
    mockPlatform("github");
    vi.mocked(collectLiveReviewStats).mockResolvedValue(stats);
  });

  afterEach(() => {
    // Move past the cache TTL so tests do not share cached scans.
    vi.advanceTimersByTime(10 * 60_000);
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it.each([0, -1, 1.5, Number.NaN, 366])("rejects days=%s", async (days) => {
    await expect(loadLiveStats(days)).rejects.toThrow(/days must be/);
    expect(collectLiveReviewStats).not.toHaveBeenCalled();
  });

  it("scans the requested window on the configured platform", async () => {
    await loadLiveStats(7);

    expect(validateConfig).toHaveBeenCalledWith(expect.anything(), "github");
    expect(collectLiveReviewStats).toHaveBeenCalledWith(expect.any(githubAdapter), {
      since: new Date("2026-03-24T00:00:00.000Z"),
      limit: 100,
    });
  });

  it("uses the Azure adapter when configured", async () => {
    mockPlatform("azure");

    await loadLiveStats(30);

    expect(collectLiveReviewStats).toHaveBeenCalledWith(
      expect.any(azureAdapter),
      expect.anything()
    );
  });

  it("rejects an unsupported platform and surfaces config errors", async () => {
    mockPlatform("gitlab");
    await expect(loadLiveStats(30)).rejects.toThrow(/Invalid platform/);

    mockPlatform("github");
    vi.mocked(validateConfig).mockImplementationOnce(() => {
      throw new Error("MM_GITHUB_TOKEN required");
    });
    await expect(loadLiveStats(30)).rejects.toThrow(/MM_GITHUB_TOKEN/);
  });

  it("reuses a scan within the TTL, then rescans", async () => {
    await loadLiveStats(90);
    await loadLiveStats(90);
    expect(collectLiveReviewStats).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(61_000);
    await loadLiveStats(90);
    expect(collectLiveReviewStats).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed scans", async () => {
    vi.mocked(collectLiveReviewStats).mockRejectedValueOnce(new Error("rate limited"));
    await expect(loadLiveStats(14)).rejects.toThrow(/rate limited/);

    await loadLiveStats(14);
    expect(collectLiveReviewStats).toHaveBeenCalledTimes(2);
  });
});
