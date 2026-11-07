import type { BotThreadState } from "@merge-mentor/domain/platform.js";
import { describe, expect, it } from "vitest";

import { classifyOutcome, parseCategory, parseSeverity, toOutcomeComment } from "./classifier.js";

const marker = (key: string): string =>
  `<!-- finding-id: ${Buffer.from(key).toString("base64")} -->`;

describe("parseCategory", () => {
  it("reads the category from the finding-id marker", () => {
    expect(parseCategory(`text\n${marker("src/a.ts:12:security")}`)).toBe("security");
  });

  it("uses the last segment so a path containing a colon still works", () => {
    expect(parseCategory(marker("C:/repo/a.ts:3:bug"))).toBe("bug");
  });

  it.each([
    ["no marker", "just text"],
    ["an unknown category", marker("a.ts:1:vibes")],
    ["a marker that is not base64 text", "<!-- finding-id: ==== -->"],
  ])("returns unknown for %s", (_name, body) => {
    expect(parseCategory(body)).toBe("unknown");
  });
});

describe("parseSeverity", () => {
  it.each([
    ["**Severity**: 🔴 Critical", "critical"],
    ["**Severity**: 🟠 High", "high"],
    ["x\n\n**Severity**: 🟡 Medium\n\n**Issue**: y", "medium"],
    ["**Severity**: 🟢 Low", "low"],
  ])("reads %j", (body, expected) => {
    expect(parseSeverity(body)).toBe(expected);
  });

  it("does not take a severity word from the issue text", () => {
    expect(parseSeverity("**Issue**: this is a high risk")).toBe("unknown");
  });

  it("returns unknown when the line was edited away", () => {
    expect(parseSeverity("no severity here")).toBe("unknown");
  });
});

describe("classifyOutcome", () => {
  it("is resolved whenever the thread was resolved", () => {
    expect(classifyOutcome(true, { state: "open", updatedAt: "" })).toBe("resolved");
    expect(classifyOutcome(true, { state: "closed", merged: true, updatedAt: "" })).toBe(
      "resolved"
    );
  });

  it("is open while the PR is open", () => {
    expect(classifyOutcome(false, { state: "open", updatedAt: "" })).toBe("open");
  });

  it("separates left-open threads on merged and unmerged PRs", () => {
    expect(classifyOutcome(false, { state: "closed", merged: true, updatedAt: "" })).toBe(
      "open-merged"
    );
    expect(classifyOutcome(false, { state: "closed", merged: false, updatedAt: "" })).toBe(
      "open-closed"
    );
  });
});

describe("toOutcomeComment", () => {
  const thread: BotThreadState = {
    path: "a.ts",
    line: 1,
    body: `**Severity**: 🟠 High\n${marker("a.ts:1:bug")}\nsecret text`,
    isResolved: true,
    createdAt: "2026-03-09T10:00:00Z",
  };

  it("keeps only the counted fields, never the text", () => {
    const result = toOutcomeComment(thread, {
      state: "closed",
      merged: true,
      updatedAt: "2026-04-01T00:00:00Z",
    });
    expect(result).toEqual({
      category: "bug",
      severity: "high",
      outcome: "resolved",
      month: "2026-03",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("falls back to the PR month when the comment has no time", () => {
    const result = toOutcomeComment(
      { ...thread, createdAt: undefined },
      { state: "open", updatedAt: "2026-04-01T00:00:00Z" }
    );
    expect(result.month).toBe("2026-04");
  });
});
