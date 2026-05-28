import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors/index.js";
import {
  formatReviewPasses,
  formatReviewTypeLabel,
  parseReviewPasses,
  resolveReviewProfile,
  validateReviewStrategy,
  validateReviewType,
} from "./reviewSelection.js";

describe("reviewSelection", () => {
  describe("validateReviewType", () => {
    it("returns the type if it is a valid review type", () => {
      expect(validateReviewType("general")).toBe("general");
      expect(validateReviewType("testing")).toBe("testing");
      expect(validateReviewType("security")).toBe("security");
      expect(validateReviewType("performance")).toBe("performance");
      expect(validateReviewType("fast")).toBe("fast");
      expect(validateReviewType("custom")).toBe("custom");
    });

    it("falls back to 'general' if type is undefined or invalid", () => {
      expect(validateReviewType(undefined)).toBe("general");
      expect(validateReviewType("invalid-type")).toBe("general");
    });
  });

  describe("validateReviewStrategy", () => {
    it("returns the strategy if it is a valid review strategy", () => {
      expect(validateReviewStrategy("deep")).toBe("deep");
      expect(validateReviewStrategy("fast")).toBe("fast");
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
    it("resolves default profile when no options are provided", () => {
      const profile = resolveReviewProfile({});

      expect(profile).toEqual({
        baseline: true,
        reviewType: "general",
        legacyAlias: undefined,
        passes: [],
        strategy: "fast",
      });
    });

    it("resolves implicit passes for predefined review types", () => {
      expect(resolveReviewProfile({ reviewType: "security" })).toEqual({
        baseline: true,
        reviewType: "security",
        legacyAlias: "security",
        passes: ["security"],
        strategy: "fast",
      });

      expect(resolveReviewProfile({ reviewType: "performance" })).toEqual({
        baseline: true,
        reviewType: "performance",
        legacyAlias: "performance",
        passes: ["performance"],
        strategy: "fast",
      });

      expect(resolveReviewProfile({ reviewType: "testing" })).toEqual({
        baseline: true,
        reviewType: "testing",
        legacyAlias: "testing",
        passes: ["testing"],
        strategy: "fast",
      });
    });

    it("throws ValidationError for custom reviewType when no explicit passes provided", () => {
      expect(() => resolveReviewProfile({ reviewType: "custom" })).toThrow(ValidationError);
      expect(() => resolveReviewProfile({ reviewType: "custom", reviewPasses: [] })).toThrow(
        ValidationError
      );
    });

    it("resolves custom reviewType when explicit passes are provided", () => {
      const profile = resolveReviewProfile({
        reviewType: "custom",
        reviewPasses: ["scan", "logic"],
      });

      expect(profile).toEqual({
        baseline: true,
        reviewType: "custom",
        legacyAlias: "custom",
        passes: ["scan", "logic"],
        strategy: "fast",
      });
    });

    it("merges explicit passes and implicit passes without duplicates", () => {
      const profile = resolveReviewProfile({
        reviewType: "security",
        reviewPasses: ["scan", "security", "logic"],
      });

      expect(profile.passes).toEqual(["scan", "security", "logic"]);
    });

    it("uses fast strategy when reviewType is fast regardless of options", () => {
      const profile = resolveReviewProfile({
        reviewType: "fast",
        reviewStrategy: "deep",
      });

      expect(profile.strategy).toBe("fast");
    });

    it("respects reviewStrategy option for other review types", () => {
      const profile = resolveReviewProfile({
        reviewType: "general",
        reviewStrategy: "deep",
      });

      expect(profile.strategy).toBe("deep");
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

  describe("formatReviewTypeLabel", () => {
    it("formats general / default baseline label", () => {
      expect(formatReviewTypeLabel("general")).toBe("Standard review");
      expect(formatReviewTypeLabel("general", [], "fast")).toBe("Standard review");
      expect(formatReviewTypeLabel("general", undefined, "deep")).toBe(
        "Standard review (deep strategy)"
      );
    });

    it("formats label with implicit passes from review type", () => {
      expect(formatReviewTypeLabel("security")).toBe("Standard review + security");
      expect(formatReviewTypeLabel("performance", [], "deep")).toBe(
        "Standard review + performance (deep strategy)"
      );
    });

    it("formats label with merged explicit passes", () => {
      expect(formatReviewTypeLabel("custom", ["scan", "logic"])).toBe(
        "Standard review + scan → logic"
      );
      expect(formatReviewTypeLabel("custom", ["scan", "logic"], "deep")).toBe(
        "Standard review + scan → logic (deep strategy)"
      );
    });

    it("formats fast review type label without deep strategy override", () => {
      expect(formatReviewTypeLabel("fast", [], "deep")).toBe("Standard review");
    });
  });
});
