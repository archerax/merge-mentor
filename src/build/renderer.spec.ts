import { describe, expect, it } from "vitest";
import { renderReport } from "./renderer.js";
import type { BuildDiagnosis, BuildReference, BuildSummary, PreparedEvidence } from "./types.js";

describe("renderReport", () => {
  const reference: BuildReference = {
    platform: "github",
    id: "42",
    ownerOrOrg: "acme",
    repository: "widget",
  };
  const summary: BuildSummary = {
    id: "42",
    name: "CI",
    status: "completed",
    result: "failed",
    webUrl: "https://example.test/build/42",
  };
  const evidence: PreparedEvidence = {
    blocks: [{ id: "E1", category: "test", confidence: 0.9, content: "Assertion failed" }],
    truncated: false,
    redacted: false,
  };
  const diagnosis: BuildDiagnosis = {
    failureType: "test",
    confidence: 0.875,
    summary: "A test failed",
    rootCause: "The assertion was incorrect",
    evidence: ["E1"],
    affectedFiles: [{ path: "src/app.ts", line: 12 }],
    recommendations: ["Fix the assertion"],
    limitations: ["Only failed logs were available"],
  };

  it("renders diagnosis, evidence, affected lines, and metadata", () => {
    const report = renderReport(reference, summary, evidence, diagnosis);

    expect(report).toContain("# CI Build Failure Analysis");
    expect(report).toContain("**Platform:** github");
    expect(report).toContain("[CI #42](https://example.test/build/42)");
    expect(report).toContain("**Confidence:** 88%");
    expect(report).toContain("### E1 (test)");
    expect(report).toContain("- `src/app.ts:12`");
    expect(report).toContain("- Fix the assertion");
  });

  it("renders explicit empty-state text", () => {
    const report = renderReport(
      reference,
      { ...summary, webUrl: undefined },
      { blocks: [], truncated: false, redacted: false },
      { ...diagnosis, affectedFiles: [], recommendations: [], limitations: [] }
    );

    expect(report).toContain("**Build:** [CI #42]()");
    expect(report).toContain("No usable log evidence was captured.");
    expect(report).toContain("- None identified");
    expect(report).toContain("- None reported");
  });
});
