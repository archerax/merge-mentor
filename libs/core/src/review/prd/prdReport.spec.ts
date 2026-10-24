import { describe, expect, it } from "vitest";

import {
  fallbackReadinessSummary,
  type PrdReviewReport,
  readinessFromCounts,
  renderPrdReportMarkdown,
  verdictLabel,
} from "./prdReport.js";
import type { PrdFinding } from "./types.js";

function finding(overrides: Partial<PrdFinding> = {}): PrdFinding {
  return {
    id: "f1",
    severity: "Major",
    dimension: "scope",
    dimensionName: "Scope and out-of-scope",
    sectionId: "s2",
    headingPath: ["Scope", "Payments"],
    quote: "Card payments are in scope.",
    problem: "It is unclear which cards. This matters for testing.",
    suggestion: "List the card types.",
    origin: "section",
    ...overrides,
  };
}

function report(overrides: Partial<PrdReviewReport> = {}): PrdReviewReport {
  return {
    schemaVersion: 1,
    kind: "prd",
    runId: "run-1",
    createdAt: "2026-10-23T00:00:00.000Z",
    documentType: "prd",
    source: { fileName: "spec.docx", sizeBytes: 10, sha256: "abc" },
    document: {
      sectionCount: 3,
      chunkCount: 2,
      reviewedChunkCount: 2,
      hasHeadings: true,
      imageCount: 0,
      commentCount: 0,
    },
    readiness: { verdict: "needs-work", summary: "Mostly fine." },
    complete: true,
    counts: { Blocker: 0, Major: 1, Minor: 0 },
    findings: [finding()],
    notReviewed: [],
    verification: {
      candidates: 3,
      droppedUnsupportedQuote: 1,
      droppedDuplicate: 0,
      droppedByVerifier: 1,
      kept: 1,
      verifierFailed: false,
    },
    includeImages: false,
    version: "1.2.3",
    ...overrides,
  };
}

describe("verdictLabel", () => {
  it("gives plain-language labels", () => {
    expect(verdictLabel("ready")).toBe("✅ Ready for development");
    expect(verdictLabel("needs-work")).toBe("🟠 Needs work before development");
    expect(verdictLabel("not-ready")).toBe("🔴 Not ready for development");
  });
});

describe("readinessFromCounts", () => {
  it("derives the verdict from the most severe finding", () => {
    expect(readinessFromCounts({ Blocker: 1, Major: 3, Minor: 0 })).toBe("not-ready");
    expect(readinessFromCounts({ Blocker: 0, Major: 1, Minor: 0 })).toBe("needs-work");
    expect(readinessFromCounts({ Blocker: 0, Major: 0, Minor: 9 })).toBe("ready");
  });
});

describe("fallbackReadinessSummary", () => {
  it("summarises the counts in plain words", () => {
    expect(fallbackReadinessSummary({ Blocker: 0, Major: 0, Minor: 0 })).toBe(
      "The review found no issues in the text it could check."
    );
    expect(fallbackReadinessSummary({ Blocker: 2, Major: 0, Minor: 1 })).toBe(
      "The review found 2 blocker, 1 minor issues."
    );
  });
});

describe("renderPrdReportMarkdown", () => {
  it("renders the verdict, findings grouped by severity and review details", () => {
    const markdown = renderPrdReportMarkdown(
      report({
        document: { ...report().document, title: "Checkout" },
        counts: { Blocker: 1, Major: 1, Minor: 0 },
        findings: [
          finding({
            id: "f1",
            severity: "Blocker",
            problem: "x".repeat(200),
            quote: "line one\nline two",
            headingPath: [],
            authorQuestion: "Which cards?",
          }),
          finding({ id: "f2", suggestion: "" }),
        ],
        readiness: { verdict: "not-ready", summary: "Fix the scope." },
        aiModel: "gpt-test",
      })
    );

    expect(
      markdown.startsWith(
        "# PRD review: Checkout\n\n## 🔴 Not ready for development\n\nFix the scope."
      )
    ).toBe(true);
    expect(markdown).toContain("| 1 | 1 | 0 |");
    expect(markdown).toContain("## 🔴 Blockers: fix before development starts");
    expect(markdown).toContain(`### 1. ${"x".repeat(117)}...`);
    expect(markdown).toContain("**Where:** Document · **Topic:** Scope and out-of-scope");
    expect(markdown).toContain("> line one\n> line two");
    expect(markdown).toContain("**Question for the author:** Which cards?");
    expect(markdown).toContain("## 🟠 Major issues: should be fixed");
    expect(markdown).toContain("### 2. It is unclear which cards.");
    expect(markdown).toContain("**Where:** Scope › Payments");
    expect(markdown).not.toContain("Minor issues");
    expect(markdown).toContain("Everything in the document's text was reviewed.");
    expect(markdown).toContain(
      "Checked and removed 2 possible issues that could not be confirmed against the document text (1 quote not found, 0 duplicate, 1 rejected on review)"
    );
    expect(markdown).toContain("PRD review, gpt-test");
    expect(markdown).toContain("<!-- merge-mentor-prd-review -->");
    expect(markdown).not.toContain("Partial review");
  });

  it("renders an FRD report with no findings, gaps and a failed double-check", () => {
    const markdown = renderPrdReportMarkdown(
      report({
        documentType: "frd",
        readiness: { verdict: "ready", summary: "Looks good." },
        counts: { Blocker: 0, Major: 0, Minor: 0 },
        findings: [],
        complete: false,
        notReviewed: [{ kind: "image", description: "Image img1: not reviewed." }],
        verification: {
          candidates: 1,
          droppedUnsupportedQuote: 1,
          droppedDuplicate: 0,
          droppedByVerifier: 0,
          kept: 0,
          verifierFailed: true,
        },
      })
    );

    expect(markdown.startsWith("# FRD review: spec.docx\n\n## ✅ Ready for development")).toBe(
      true
    );
    expect(markdown).toContain("Partial review");
    expect(markdown).toContain("No issues were found in the reviewed text.");
    expect(markdown).toContain("- Image img1: not reviewed.");
    expect(markdown).toContain("Functional Requirements Document (FRD)");
    expect(markdown).toContain("removed 1 possible issue that");
    expect(markdown).toContain("The final double-check could not run");
    expect(markdown).toContain("FRD review, AI model");
  });

  it("warns when the provider kept session data", () => {
    const markdown = renderPrdReportMarkdown(report({ retainedSessionData: { count: 1 } }));
    expect(markdown).toContain(
      "could not delete its saved conversation for 1 request. Parts of this document may remain"
    );
  });

  it("falls back to a generic title when the problem text is empty", () => {
    const markdown = renderPrdReportMarkdown(report({ findings: [finding({ problem: "" })] }));
    expect(markdown).toContain("### 1. Issue");
  });
});
