import { ValidationError } from "@merge-mentor/shared/errors/index.js";
import { describe, expect, it } from "vitest";

import {
  formatReviewPasses,
  formatReviewProfileLabel,
  parseReviewPasses,
  resolveReviewProfile,
  validateReviewStrategy,
} from "./reviewSelection.js";

describe("reviewSelection", () => {
  describe("validateReviewStrategy", () => {
    it("returns the strategy if it is a valid review strategy", () => {
      expect(validateReviewStrategy("deep")).toBe("deep");
      expect(validateReviewStrategy("fast")).toBe("fast");
      expect(validateReviewStrategy("multi-agent")).toBe("multi-agent");
    });

    it("falls back to 'fast' if strategy is undefined or invalid", () => {
      expect(validateReviewStrategy(undefined)).toBe("fast");
      expect(validateReviewStrategy("invalid-strategy")).toBe("fast");
    });
  });

  describe("parseReviewPasses", () => {
    it("returns undefined for undefined or empty/whitespace input", () => {
      expect(parseReviewPasses(undefined)).toBeUndefined();
      expect(parseReviewPasses("")).toBeUndefined();
      expect(parseReviewPasses("   ")).toBeUndefined();
    });

    it("parses a comma-separated list of valid passes", () => {
      const result = parseReviewPasses("scan,security,logic");
      expect(result).toEqual(["scan", "security", "logic"]);
    });

    it("handles spaces and mixed casing in pass list", () => {
      const result = parseReviewPasses("  Scan ,  security , LOGIC  ");
      expect(result).toEqual(["scan", "security", "logic"]);
    });

    it("throws ValidationError for duplicate passes", () => {
      expect(() => parseReviewPasses("scan,logic,scan")).toThrow(ValidationError);
      expect(() => parseReviewPasses("scan,logic,scan")).toThrow(
        'Validation failed for passes: Duplicate pass "scan" is not allowed'
      );
    });

    it("throws ValidationError for unknown passes", () => {
      expect(() => parseReviewPasses("scan,unknown-pass,logic")).toThrow(ValidationError);
      expect(() => parseReviewPasses("scan,unknown-pass,logic")).toThrow(
        'Validation failed for passes: Unknown pass "unknown-pass". Valid passes: scan, security, logic, performance, monorepo, testing, database'
      );
    });

    it("throws ValidationError for empty comma-separated lists", () => {
      expect(() => parseReviewPasses(",,")).toThrow(ValidationError);
      expect(() => parseReviewPasses(",,")).toThrow(
        "Validation failed for passes: At least one pass is required."
      );
    });
  });

  describe("resolveReviewProfile", () => {
    it("resolves the default profile when no options are provided", () => {
      const profile = resolveReviewProfile({});

      expect(profile).toEqual({
        passes: [],
        strategy: "fast",
      });
    });

    it("rejects explicit passes under non-multi-agent strategies", () => {
      expect(() =>
        resolveReviewProfile({ reviewPasses: ["scan"], reviewStrategy: "fast" })
      ).toThrow(ValidationError);
      expect(() =>
        resolveReviewProfile({ reviewPasses: ["scan"], reviewStrategy: "deep" })
      ).toThrow(ValidationError);
      expect(() => resolveReviewProfile({ reviewPasses: ["scan"] })).toThrow(ValidationError);
    });

    it("resolves explicit passes under the multi-agent strategy", () => {
      const profile = resolveReviewProfile({
        reviewPasses: ["scan", "logic"],
        reviewStrategy: "multi-agent",
      });

      expect(profile).toEqual({
        passes: ["scan", "logic"],
        strategy: "multi-agent",
      });
    });

    it("respects the reviewStrategy option", () => {
      expect(resolveReviewProfile({ reviewStrategy: "deep" }).strategy).toBe("deep");
      expect(resolveReviewProfile({ reviewStrategy: "multi-agent" }).strategy).toBe("multi-agent");
    });
  });

  describe("formatReviewPasses", () => {
    it("returns undefined for undefined or empty list", () => {
      expect(formatReviewPasses(undefined)).toBeUndefined();
      expect(formatReviewPasses([])).toBeUndefined();
    });

    it("joins passes with arrows", () => {
      expect(formatReviewPasses(["scan", "logic", "security"])).toBe("scan → logic → security");
    });
  });

  describe("formatReviewProfileLabel", () => {
    it("formats the default baseline label", () => {
      expect(formatReviewProfileLabel()).toBe("Standard review");
      expect(formatReviewProfileLabel([], "fast")).toBe("Standard review");
      expect(formatReviewProfileLabel(undefined, "deep")).toBe("Standard review (deep strategy)");
    });

    it("formats label with explicit passes", () => {
      expect(formatReviewProfileLabel(["scan", "logic"])).toBe("Standard review + scan → logic");
      expect(formatReviewProfileLabel(["scan", "logic"], "deep")).toBe(
        "Standard review + scan → logic (deep strategy)"
      );
    });

    it("formats multi-agent strategy labels", () => {
      expect(formatReviewProfileLabel(undefined, "multi-agent")).toBe(
        "Standard review (multi-agent strategy)"
      );
      expect(formatReviewProfileLabel(["scan", "logic"], "multi-agent")).toBe(
        "Standard review + scan → logic (multi-agent strategy)"
      );
    });
  });
});
