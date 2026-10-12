import { describe, expect, it } from "vitest";

import { generateReviewRunId, isReviewRunId, sanitizeRunTarget } from "./reviewRunId.js";

describe("reviewRunId", () => {
  describe("sanitizeRunTarget", () => {
    it("replaces unsafe character runs with a hyphen", () => {
      expect(sanitizeRunTarget("pr:github:acme/widgets:42")).toBe("pr-github-acme-widgets-42");
    });

    it("trims leading and trailing punctuation", () => {
      expect(sanitizeRunTarget("...")).toBe("run");
      expect(sanitizeRunTarget("--abc--")).toBe("abc");
    });

    it("caps the prefix length", () => {
      expect(sanitizeRunTarget("a".repeat(200)).length).toBe(80);
    });
  });

  describe("generateReviewRunId", () => {
    it("embeds the sanitized target and is URL-safe", () => {
      const id = generateReviewRunId("pr:github:acme/widgets:42");
      expect(id).toMatch(/^pr-github-acme-widgets-42-[0-9a-z]+-[0-9a-f]{8}$/);
      expect(isReviewRunId(id)).toBe(true);
    });

    it("produces unique ids for the same target", () => {
      const first = generateReviewRunId("target");
      const second = generateReviewRunId("target");
      expect(first).not.toBe(second);
    });
  });

  describe("isReviewRunId", () => {
    it("accepts path-safe ids and rejects traversal", () => {
      expect(isReviewRunId("pr-123-abc")).toBe(true);
      expect(isReviewRunId("../etc/passwd")).toBe(false);
      expect(isReviewRunId("")).toBe(false);
      expect(isReviewRunId("a".repeat(201))).toBe(false);
    });

    it("rejects dot-only ids that resolve to a parent directory", () => {
      expect(isReviewRunId(".")).toBe(false);
      expect(isReviewRunId("..")).toBe(false);
      expect(isReviewRunId("...")).toBe(false);
    });
  });
});
