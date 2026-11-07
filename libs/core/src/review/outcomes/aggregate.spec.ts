import { describe, expect, it } from "vitest";

import { aggregateOutcomes } from "./aggregate.js";
import type { CommentOutcome, OutcomeComment, ScannedPr } from "./types.js";

const comment = (
  outcome: CommentOutcome,
  category = "bug",
  severity = "high",
  month = "2026-01"
): OutcomeComment => ({ category, severity, outcome, month });

const pr = (...comments: OutcomeComment[]): ScannedPr => ({
  updatedAt: "2026-01-01T00:00:00Z",
  state: "closed",
  scannedAt: "2026-02-01T00:00:00Z",
  comments,
});

describe("aggregateOutcomes", () => {
  it("returns zeros and a null rate for no PRs", () => {
    const stats = aggregateOutcomes([]);
    expect(stats).toMatchObject({
      total: 0,
      prsScanned: 0,
      prsWithComments: 0,
      resolutionRate: null,
    });
    expect(stats.byMonth).toEqual([]);
  });

  it("counts PRs with and without comments", () => {
    const stats = aggregateOutcomes([pr(), pr(comment("resolved")), pr(comment("open-merged"))]);
    expect(stats.prsScanned).toBe(3);
    expect(stats.prsWithComments).toBe(2);
  });

  it("excludes in-flight threads from the resolution rate", () => {
    const stats = aggregateOutcomes([
      pr(comment("resolved"), comment("resolved"), comment("open-merged"), comment("open")),
    ]);
    expect(stats).toMatchObject({ total: 4, resolved: 2, openMerged: 1, open: 1 });
    expect(stats.resolutionRate).toBeCloseTo(2 / 3);
  });

  it("has a null rate when every thread is still in flight", () => {
    expect(aggregateOutcomes([pr(comment("open"))]).resolutionRate).toBeNull();
  });

  it("breaks down by category and severity", () => {
    const stats = aggregateOutcomes([
      pr(comment("resolved", "bug", "high"), comment("open-closed", "security", "unknown")),
    ]);
    expect(stats.byCategory.bug.resolved).toBe(1);
    expect(stats.byCategory.security.openClosed).toBe(1);
    expect(stats.bySeverity.unknown.total).toBe(1);
  });

  it("orders months oldest first across a year boundary", () => {
    const stats = aggregateOutcomes([
      pr(
        comment("resolved", "bug", "high", "2026-01"),
        comment("resolved", "bug", "high", "2025-12")
      ),
    ]);
    expect(stats.byMonth.map((m) => m.month)).toEqual(["2025-12", "2026-01"]);
  });
});
