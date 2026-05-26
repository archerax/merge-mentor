import { describe, expect, it } from "vitest";
import { buildSelectedPassesSection } from "./passHelpers.js";

describe("buildSelectedPassesSection", () => {
  it("returns an empty string when selectedPasses is undefined", () => {
    expect(buildSelectedPassesSection(undefined)).toBe("");
  });

  it("returns an empty string when selectedPasses is an empty array", () => {
    expect(buildSelectedPassesSection([])).toBe("");
  });

  it("includes the ADDITIVE REVIEW PASSES header", () => {
    const result = buildSelectedPassesSection(["security"]);
    expect(result).toContain("ADDITIVE REVIEW PASSES");
  });

  it("numbers passes starting from 1", () => {
    const result = buildSelectedPassesSection(["security"]);
    expect(result).toContain("1. security");
  });

  it("renders multiple passes in order with sequential numbers", () => {
    const result = buildSelectedPassesSection(["security", "performance", "testing"]);
    expect(result).toContain("1. security");
    expect(result).toContain("2. performance");
    expect(result).toContain("3. testing");
  });

  it("includes the note about passes adding focus without restricting", () => {
    const result = buildSelectedPassesSection(["security"]);
    expect(result).toContain("These passes add focus and context");
    expect(result).toContain("They do **not** restrict what issues you may report");
  });

  it("returns a non-empty string for a single pass", () => {
    const result = buildSelectedPassesSection(["performance"]);
    expect(result.trim().length).toBeGreaterThan(0);
  });
});
