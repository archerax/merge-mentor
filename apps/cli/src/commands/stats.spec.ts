import { describe, expect, it } from "vitest";

import { formatStats, parseSince } from "./stats.js";

const emptyComments = { inline: 0, replies: 0, general: 0, total: 0, failed: 0 };

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
});

describe("formatStats", () => {
  it("reports when there is no activity", () => {
    const lines = formatStats({
      reviewRuns: 0,
      prsReviewed: 0,
      filesReviewed: 0,
      comments: emptyComments,
      byPlatform: [],
    });
    expect(lines.join("\n")).toContain("No review activity found");
  });

  it("prints totals and failures", () => {
    const text = formatStats({
      reviewRuns: 4,
      prsReviewed: 3,
      filesReviewed: 10,
      comments: { inline: 5, replies: 1, general: 2, total: 8, failed: 1 },
      byPlatform: [],
    }).join("\n");
    expect(text).toContain("PRs reviewed:     3");
    expect(text).toContain("Comments posted:  8 (5 inline, 1 replies, 2 general)");
    expect(text).toContain("Comments failed:  1");
  });
});
