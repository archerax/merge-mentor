import { describe, expect, it } from "vitest";
import { parseDiagnosis } from "./parser.js";
import type { PreparedEvidence } from "./types.js";

const evidence: PreparedEvidence = {
  blocks: [{ id: "E1", category: "test", confidence: 0.8, content: "test failed" }],
  redacted: false,
  truncated: false,
};

describe("parseDiagnosis", () => {
  it("removes unsupported evidence citations and downgrades unsupported claims", () => {
    const diagnosis = parseDiagnosis(
      JSON.stringify({
        failureType: "test",
        confidence: 0.9,
        summary: "A test failed",
        rootCause: "The assertion failed",
        evidence: ["E1", "E99"],
        affectedFiles: [],
        recommendations: ["Inspect the assertion"],
        limitations: [],
      }),
      evidence
    );
    expect(diagnosis.evidence).toEqual(["E1"]);
    expect(diagnosis.limitations[0]).toContain("not supplied");
  });

  it("does not accept a diagnosis without valid evidence", () => {
    const diagnosis = parseDiagnosis(
      JSON.stringify({
        failureType: "compilation",
        confidence: 1,
        summary: "made up",
        rootCause: "made up",
        evidence: ["missing"],
        affectedFiles: [],
        recommendations: [],
        limitations: [],
      }),
      evidence
    );
    expect(diagnosis.failureType).toBe("unknown");
    expect(diagnosis.confidence).toBe(0);
  });
});
