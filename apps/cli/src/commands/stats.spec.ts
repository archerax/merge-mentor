import { describe, expect, it } from "vitest";

import { formatLiveStats, parseLimit, parseSince } from "./stats.js";

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

describe("parseLimit", () => {
  it("accepts positive integers", () => {
    expect(parseLimit("25")).toBe(25);
  });

  it.each(["0", "-1", "1.5", "abc"])("rejects %s", (value) => {
    expect(() => parseLimit(value)).toThrow(/positive integer/);
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
