import { describe, expect, it } from "vitest";

import { compareReviews } from "./prdDelta.js";
import type { PrdReviewReport } from "./prdReport.js";
import type { PrdFinding } from "./types.js";

function finding(id: string, overrides: Partial<PrdFinding> = {}): PrdFinding {
  return {
    id,
    severity: "Major",
    dimension: "scope",
    dimensionName: "Scope",
    sectionId: "s1",
    headingPath: ["Scope"],
    quote: "Card payments are in scope for the first release.",
    problem: "It is unclear which card types are supported.",
    suggestion: "List the card types.",
    origin: "section",
    ...overrides,
  };
}

function previousReport(
  findings: PrdFinding[],
  overrides: Partial<PrdReviewReport> = {}
): PrdReviewReport {
  return {
    schemaVersion: 1,
    kind: "prd",
    runId: "run-old",
    createdAt: "2026-10-01T00:00:00.000Z",
    documentType: "prd",
    source: { fileName: "spec.docx", sizeBytes: 1, sha256: "a" },
    document: {
      sectionCount: 1,
      chunkCount: 1,
      reviewedChunkCount: 1,
      hasHeadings: true,
      imageCount: 0,
      commentCount: 0,
    },
    readiness: { verdict: "needs-work", summary: "" },
    complete: true,
    counts: { Blocker: 0, Major: findings.length, Minor: 0 },
    findings,
    notReviewed: [],
    verification: {
      candidates: 0,
      droppedUnsupportedQuote: 0,
      droppedDuplicate: 0,
      droppedByVerifier: 0,
      kept: findings.length,
      verifierFailed: false,
    },
    includeImages: false,
    version: "1",
    ...overrides,
  };
}

const image = (id: string): PrdFinding =>
  finding(id, { quote: "", imageId: "img1", problem: "Flow contradicts the text." });

describe("compareReviews", () => {
  it("treats the same quote and problem as still open, with renumbered ids", () => {
    const result = compareReviews(previousReport([finding("f1")]), [finding("f7")], true);
    expect(result.stillOpenFindingIds).toEqual(["f7"]);
    expect(result.newFindingIds).toEqual([]);
    expect(result.resolved).toEqual([]);
  });

  it("matches a finding whose quoted text was lightly reworded", () => {
    const reworded = finding("f1", {
      quote: "Card payments are in scope for the first release only.",
    });
    const result = compareReviews(previousReport([finding("f1")]), [reworded], true);
    expect(result.stillOpenFindingIds).toEqual(["f1"]);
  });

  it("reports fixed findings as resolved and unmatched ones as new", () => {
    const old = finding("f1");
    const added = finding("f1", {
      quote: "Refunds are processed within a reasonable time.",
      problem: "Reasonable time is not measurable.",
      dimension: "ambiguity",
    });
    const result = compareReviews(previousReport([old]), [added], true);
    expect(result.resolved).toEqual([old]);
    expect(result.newFindingIds).toEqual(["f1"]);
    expect(result.stillOpenFindingIds).toEqual([]);
  });

  it("pairs each finding at most once when several share a quote", () => {
    const a = finding("f1", { problem: "Card types are not listed." });
    const b = finding("f2", { problem: "Currency handling is not described.", dimension: "x" });
    const result = compareReviews(
      previousReport([a, b]),
      [finding("f1", { problem: "Card types are not listed." })],
      true
    );
    expect(result.stillOpenFindingIds).toEqual(["f1"]);
    expect(result.resolved).toHaveLength(1);
  });

  it("matches image findings by image id", () => {
    const result = compareReviews(previousReport([image("f1")]), [image("f3")], true);
    expect(result.stillOpenFindingIds).toEqual(["f3"]);
  });

  it("warns that resolved may be overstated when the current review is partial", () => {
    const result = compareReviews(previousReport([finding("f1")]), [], false);
    expect(result.resolved).toHaveLength(1);
    expect(result.caveat).toContain("did not cover the whole document");
  });

  it("warns that new may be overstated when the earlier review was partial", () => {
    const result = compareReviews(previousReport([], { complete: false }), [finding("f1")], true);
    expect(result.caveat).toContain("earlier review was partial");
  });

  it("records the earlier verdict and counts", () => {
    const result = compareReviews(previousReport([finding("f1")]), [], true);
    expect(result.previousRunId).toBe("run-old");
    expect(result.previousVerdict).toBe("needs-work");
    expect(result.previousCounts.Major).toBe(1);
    expect(result.caveat).toBeUndefined();
  });
});
