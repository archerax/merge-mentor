import type {
  ExistingComment,
  PlatformAdapter,
  PullRequestLister,
  PullRequestSummary,
} from "@merge-mentor/domain/platform.js";
import { describe, expect, it, vi } from "vitest";

import { collectLiveReviewStats } from "./reviewStats.js";

function createAdapter(
  pulls: PullRequestSummary[],
  commentsByPr: Record<number, ExistingComment[] | Error>
): PlatformAdapter & PullRequestLister {
  return {
    getPlatformName: () => "github",
    getProjectIdentifier: () => "repo",
    listPullRequests: vi.fn().mockResolvedValue(pulls),
    getExistingBotComments: vi.fn(async (pr: number) => {
      const result = commentsByPr[pr];
      if (result instanceof Error) throw result;
      return result ?? [];
    }),
  } as unknown as PlatformAdapter & PullRequestLister;
}

const pull = (number: number, state: "open" | "closed" = "open"): PullRequestSummary => ({
  number,
  title: `PR ${number}`,
  state,
  updatedAt: "2026-03-01T00:00:00Z",
});

describe("collectLiveReviewStats", () => {
  it("counts PRs with bot comments and splits inline from general", async () => {
    const adapter = createAdapter([pull(1), pull(2, "closed"), pull(3)], {
      1: [
        { id: 1, body: "a", path: "a.ts", line: 1 },
        { id: 2, body: "summary" },
      ],
      2: [{ id: 3, body: "b", path: "b.ts", line: 2 }],
      3: [],
    });

    const stats = await collectLiveReviewStats(adapter, { limit: 10 });

    expect(stats).toMatchObject({
      platform: "github",
      project: "repo",
      prsScanned: 3,
      prsReviewed: 2,
      totalComments: 3,
      inlineComments: 2,
      generalComments: 1,
      prsFailed: 0,
      truncated: false,
    });
    expect(stats.reviewedPullRequests.map((p) => p.number)).toEqual([1, 2]);
  });

  it("excludes PRs whose comments cannot be fetched and reports them", async () => {
    const adapter = createAdapter([pull(1), pull(2)], {
      1: new Error("boom"),
      2: [{ id: 1, body: "x" }],
    });

    const stats = await collectLiveReviewStats(adapter, { limit: 10 });

    expect(stats.prsFailed).toBe(1);
    expect(stats.prsReviewed).toBe(1);
  });

  it("flags truncation when the limit is reached and forwards the window", async () => {
    const adapter = createAdapter([pull(1), pull(2)], {});
    const since = new Date("2026-01-01T00:00:00Z");

    const stats = await collectLiveReviewStats(adapter, { limit: 2, since, concurrency: 1 });

    expect(stats.truncated).toBe(true);
    expect(adapter.listPullRequests).toHaveBeenCalledWith({ since, limit: 2 });
  });

  it("handles a repository with no PRs", async () => {
    const stats = await collectLiveReviewStats(createAdapter([], {}), { limit: 10 });

    expect(stats.prsScanned).toBe(0);
    expect(stats.truncated).toBe(false);
  });
});
