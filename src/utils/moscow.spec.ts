import { describe, expect, it } from "vitest";
import { extractMoSCoWTag } from "./moscow.js";

describe("extractMoSCoWTag", () => {
  it("returns undefined for empty tags", () => {
    expect(extractMoSCoWTag([])).toBeUndefined();
    expect(extractMoSCoWTag(["other-tag", "feature"])).toBeUndefined();
  });

  it("extracts 'Must' from various formats", () => {
    expect(extractMoSCoWTag(["must"])).toBe("Must");
    expect(extractMoSCoWTag(["Must Have"])).toBe("Must");
    expect(extractMoSCoWTag(["must-have"])).toBe("Must");
  });

  it("extracts 'Should' from various formats", () => {
    expect(extractMoSCoWTag(["should"])).toBe("Should");
    expect(extractMoSCoWTag(["Should Have"])).toBe("Should");
    expect(extractMoSCoWTag(["should-have"])).toBe("Should");
  });

  it("extracts 'Could' from various formats", () => {
    expect(extractMoSCoWTag(["could"])).toBe("Could");
    expect(extractMoSCoWTag(["Could Have"])).toBe("Could");
    expect(extractMoSCoWTag(["could-have"])).toBe("Could");
  });

  it("extracts 'Won't' from various formats", () => {
    expect(extractMoSCoWTag(["won't"])).toBe("Won't");
    expect(extractMoSCoWTag(["wont"])).toBe("Won't");
    expect(extractMoSCoWTag(["Won't Have"])).toBe("Won't");
    expect(extractMoSCoWTag(["wont have"])).toBe("Won't");
    expect(extractMoSCoWTag(["won't-have"])).toBe("Won't");
    expect(extractMoSCoWTag(["wont-have"])).toBe("Won't");
  });

  it("returns the first matching MoSCoW tag in array order", () => {
    expect(extractMoSCoWTag(["should", "must"])).toBe("Should");
    expect(extractMoSCoWTag(["other", "could", "should"])).toBe("Could");
  });

  it("extracts MoSCoW tags with priority/moscow prefixes and namespaces", () => {
    expect(extractMoSCoWTag(["prio:must"])).toBe("Must");
    expect(extractMoSCoWTag(["priority/should"])).toBe("Should");
    expect(extractMoSCoWTag(["moscow-could"])).toBe("Could");
    expect(extractMoSCoWTag(["prio:wont-have"])).toBe("Won't");
    expect(extractMoSCoWTag(["priority: must-have"])).toBe("Must");
    expect(extractMoSCoWTag(["moscow/should"])).toBe("Should");
  });

  it("does not match false positives containing MoSCoW keywords", () => {
    expect(extractMoSCoWTag(["must-fix"])).toBeUndefined();
    expect(extractMoSCoWTag(["should-verify"])).toBeUndefined();
    expect(extractMoSCoWTag(["could-be-improved"])).toBeUndefined();
    expect(extractMoSCoWTag(["wont-fix"])).toBeUndefined();
  });
});
