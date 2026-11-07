import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { PrdReviewSummary } from "../server/prd.types.js";
import { renderWithQuery } from "../test/renderWithQuery.test-helper.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...rest }: { children?: ReactNode }) => <a {...rest}>{children}</a>,
}));

const { PrdBreakdownPanel } = await import("./PrdBreakdownPanel.js");

function renderHtml(ui: ReactNode): string {
  return renderWithQuery(ui).html;
}

function review(verdict: "ready" | "needs-work" | "not-ready"): PrdReviewSummary {
  return {
    prdRunId: "run-1",
    reportName: "prd-run-1-review-report.md",
    reportMarkdown: "# review",
    report: { readiness: { verdict, summary: "" } },
  } as unknown as PrdReviewSummary;
}

describe("PrdBreakdownPanel", () => {
  it("offers to break a reviewed document down", () => {
    const html = renderHtml(<PrdBreakdownPanel review={review("needs-work")} />);

    expect(html).toContain("Break it down into work items");
    expect(html).toContain("epics, features and product backlog");
    expect(html).toContain("Break down into work items");
    expect(html).not.toContain("Break down anyway");
    expect(html).not.toContain("The review found blockers");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>.*Break down into work items/);
  });

  it("does not offer a second breakdown while resuming one from the URL", () => {
    const html = renderHtml(
      <PrdBreakdownPanel
        review={review("needs-work")}
        breakdownRunId="web-20261023120000-aabbccdd"
      />
    );

    expect(html).not.toContain("Break it down into work items");
    expect(html).not.toContain("Break down into work items");
  });

  it("asks for confirmation before breaking down a document with blockers", () => {
    const html = renderHtml(<PrdBreakdownPanel review={review("not-ready")} />);

    expect(html).toContain("The review found blockers");
    expect(html).toContain("Break down anyway");
    // The plain button is disabled so the blockers cannot be skipped by accident.
    expect(html).toMatch(
      /<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Break down into work items/
    );
  });
});
