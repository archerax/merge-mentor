import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ReviewSummary } from "../server/review.types.js";
import { ReviewResult } from "./ReviewRunner.js";

function renderHtml(ui: ReactNode): string {
  return renderToStaticMarkup(<MantineProvider>{ui}</MantineProvider>);
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function buildSummary(overrides: Partial<ReviewSummary> = {}): ReviewSummary {
  return {
    platform: "github",
    number: 7,
    title: "Add widget",
    author: "octocat",
    baseBranch: "main",
    headBranch: "feature",
    url: "https://github.com/acme/widgets/pull/7",
    filesReviewed: 1,
    filesSkipped: 0,
    filesIgnored: 0,
    linesAdded: 5,
    linesDeleted: 1,
    findings: [
      {
        file: "src/a.ts",
        line: 10,
        severity: "high",
        category: "bug",
        message: "Off-by-one error.",
      },
    ],
    crossFileFindings: [],
    overallAssessment: "Looks mostly fine.",
    recommendations: [],
    commentsCreated: 0,
    commentErrors: [],
    dryRun: true,
    pendingComments: [],
    ...overrides,
  };
}

const target = { pr: 7 };

describe("ReviewResult", () => {
  it("renders each finding once with an inline Post button", () => {
    const summary = buildSummary({
      pendingComments: [
        {
          path: "src/a.ts",
          line: 10,
          body: "### Bug Issue\n\n**Issue**: Off-by-one error.\n",
          fingerprint: "fp-finding",
          posted: false,
        },
        {
          body: "Review summary body.",
          fingerprint: "fp-summary",
          posted: false,
        },
      ],
    });

    const html = renderHtml(<ReviewResult summary={summary} target={target} />);

    expect(occurrences(html, "Off-by-one error.")).toBe(1);
    expect(occurrences(html, 'aria-label="Post src/a.ts:10"')).toBe(1);
  });

  it("renders the general summary comment as a postable row", () => {
    const summary = buildSummary({
      pendingComments: [
        {
          body: "Review summary body.",
          fingerprint: "fp-summary",
          posted: false,
        },
      ],
    });

    const html = renderHtml(<ReviewResult summary={summary} target={target} />);

    expect(html).toContain("Review summary body.");
    expect(html).toContain("Post planned comments");
  });

  it("does not offer posting controls in write mode", () => {
    const summary = buildSummary({ dryRun: false, pendingComments: [] });

    const html = renderHtml(<ReviewResult summary={summary} target={target} />);

    expect(html).not.toContain("Post planned comments");
    expect(html).not.toContain('aria-label="Post src/a.ts:10"');
  });
});
