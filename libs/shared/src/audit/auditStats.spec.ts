import { describe, expect, it } from "vitest";

import type { AuditLogEntry } from "./auditReader.js";
import { computeAuditStats } from "./auditStats.js";

function entry(
  eventType: string,
  metadata: Record<string, unknown>,
  overrides: Partial<AuditLogEntry> = {}
): AuditLogEntry {
  return {
    eventType,
    timestamp: "2026-03-01T10:00:00.000Z",
    severity: "info",
    actor: "merge-mentor-bot",
    resource: { type: "review", id: "x" },
    action: "action",
    result: "success",
    metadata,
    sourceFile: "a.log",
    lineNumber: 1,
    ...overrides,
  };
}

const review = (prNumber: number, platform = "github", filesReviewed = 2) =>
  entry("review.complete", { prNumber, platform, filesReviewed });

describe("computeAuditStats", () => {
  it("returns zeros for no entries", () => {
    const stats = computeAuditStats([]);
    expect(stats.reviewRuns).toBe(0);
    expect(stats.prsReviewed).toBe(0);
    expect(stats.comments.total).toBe(0);
    expect(stats.byPlatform).toEqual([]);
    expect(stats.firstEventAt).toBeUndefined();
  });

  it("counts distinct PRs separately from review runs", () => {
    const stats = computeAuditStats([review(1), review(1), review(2)]);
    expect(stats.reviewRuns).toBe(3);
    expect(stats.prsReviewed).toBe(2);
    expect(stats.filesReviewed).toBe(6);
  });

  it("does not merge the same PR number across platforms", () => {
    const stats = computeAuditStats([review(1, "github"), review(1, "azure")]);
    expect(stats.prsReviewed).toBe(2);
    expect(stats.byPlatform.map((p) => p.platform)).toEqual(["azure", "github"]);
  });

  it("classifies successful and failed comment posts", () => {
    const stats = computeAuditStats([
      entry("comment.post.inline", { platform: "github", path: "a.ts", line: 3 }),
      entry("comment.post.inline", { platform: "github", path: "thread", line: 0 }),
      entry("comment.post.general", { platform: "github" }),
      entry("comment.post.inline", { platform: "github", path: "b.ts" }, { result: "failure" }),
    ]);
    expect(stats.comments).toEqual({ inline: 1, replies: 1, general: 1, total: 3, failed: 1 });
  });

  it("ignores unrelated events and handles missing platform", () => {
    const stats = computeAuditStats([
      entry("pr.files.fetch", { platform: "github" }),
      entry("review.complete", { prNumber: 7 }),
    ]);
    expect(stats.reviewRuns).toBe(1);
    expect(stats.byPlatform[0].platform).toBe("unknown");
  });

  it("filters by since and reports the activity range", () => {
    const old = entry(
      "review.complete",
      { prNumber: 1, platform: "github" },
      {
        timestamp: "2026-01-01T00:00:00.000Z",
      }
    );
    const recent = entry(
      "review.complete",
      { prNumber: 2, platform: "github" },
      {
        timestamp: "2026-03-05T00:00:00.000Z",
      }
    );
    const stats = computeAuditStats([old, recent], { since: new Date("2026-02-01T00:00:00Z") });
    expect(stats.prsReviewed).toBe(1);
    expect(stats.firstEventAt).toBe("2026-03-05T00:00:00.000Z");
    expect(stats.lastEventAt).toBe("2026-03-05T00:00:00.000Z");
  });
});
