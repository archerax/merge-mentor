import { MantineProvider } from "@mantine/core";
import type { PrdReviewReport } from "@merge-mentor/core/review/prd/prdReport.js";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PrdReviewSummary } from "../server/prd.types.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string;
    search?: { report?: string };
    children?: ReactNode;
  }) => (
    <a href={`${to}?report=${search?.report ?? ""}`} {...rest}>
      {children}
    </a>
  ),
}));

const { checkPickedFile, formatFileSize, PrdReviewResult, PrdReviewRunner } =
  await import("./PrdReviewRunner.js");

function renderHtml(ui: ReactNode): string {
  return renderToStaticMarkup(<MantineProvider>{ui}</MantineProvider>);
}

function buildSummary(overrides: Partial<PrdReviewReport> = {}): PrdReviewSummary {
  const report = {
    schemaVersion: 1,
    kind: "prd",
    runId: "20261023-120000-checkout-abc123",
    createdAt: "2026-10-23T12:00:00.000Z",
    documentType: "frd",
    source: { fileName: "Checkout.docx", sizeBytes: 1000, sha256: "abc" },
    document: {
      title: "Checkout",
      sectionCount: 3,
      chunkCount: 1,
      reviewedChunkCount: 1,
      hasHeadings: true,
      imageCount: 0,
      commentCount: 0,
    },
    readiness: { verdict: "needs-work", summary: "Some gaps." },
    complete: true,
    counts: { Blocker: 0, Major: 1, Minor: 2 },
    findings: [],
    notReviewed: [],
    verification: {
      candidates: 3,
      droppedUnsupportedQuote: 0,
      droppedDuplicate: 0,
      droppedByVerifier: 0,
      kept: 3,
      verifierFailed: false,
    },
    includeImages: false,
    version: "4.0.0",
    ...overrides,
  } as PrdReviewReport;
  return {
    prdRunId: report.runId,
    reportName: `prd-${report.runId}-review-report.md`,
    report,
    reportMarkdown: "# FRD review\n\n## Major issues\n\nThe login rule is vague.",
  };
}

describe("PrdReviewResult", () => {
  it("shows the verdict, counts, report and a link to the Reports page", () => {
    const html = renderHtml(<PrdReviewResult summary={buildSummary()} />);

    expect(html).toContain("FRD review result");
    expect(html).toContain("Checkout · Checkout.docx");
    expect(html).toContain("Needs work");
    expect(html).toContain("0 blockers");
    expect(html).toContain("1 major issue<");
    expect(html).toContain("2 minor issues");
    expect(html).toContain("The login rule is vague.");
    expect(html).toContain(
      'href="/reports?report=prd-20261023-120000-checkout-abc123-review-report.md"'
    );
    expect(html).not.toContain("partly reviewed");
  });

  it("flags a partly reviewed document", () => {
    const html = renderHtml(
      <PrdReviewResult
        summary={buildSummary({
          complete: false,
          readiness: { verdict: "not-ready", summary: "Blocked." },
        })}
      />
    );

    expect(html).toContain("Not ready");
    expect(html).toContain("partly reviewed");
  });
});

describe("PrdReviewRunner", () => {
  it("renders the upload form with the opt-in image note and the confidentiality note", () => {
    const html = renderHtml(<PrdReviewRunner />);

    expect(html).toContain("Requirements document");
    expect(html).toContain("Product requirements (PRD)");
    expect(html).toContain("Functional requirements (FRD)");
    expect(html).toContain("Include images");
    expect(html).toContain("may take longer and cost more");
    expect(html).toContain("Your document stays local");
    expect(html).toContain(".mergementor");
    expect(html).toContain("Review document");
  });
});

describe("checkPickedFile", () => {
  it.each([
    [null, /Choose a Word document/],
    [{ name: "spec.doc", size: 10 }, /older Word file/],
    [{ name: "spec.pdf", size: 10 }, /saved as .docx/],
    [{ name: "spec.docx", size: 0 }, /empty/],
    [{ name: "spec.docx", size: 21 * 1024 * 1024 }, /21\.0 MB; the limit is 20\.0 MB/],
  ])("rejects %j", (file, message) => {
    expect(checkPickedFile(file)).toMatch(message);
  });

  it("accepts a .docx under the limit", () => {
    expect(checkPickedFile({ name: "Spec.DOCX", size: 2048 })).toBeNull();
  });
});

describe("formatFileSize", () => {
  it("formats kilobytes and megabytes", () => {
    expect(formatFileSize(100)).toBe("1 KB");
    expect(formatFileSize(10 * 1024)).toBe("10 KB");
    expect(formatFileSize(5.5 * 1024 * 1024)).toBe("5.5 MB");
  });
});
