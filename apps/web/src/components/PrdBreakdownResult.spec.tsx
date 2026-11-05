import { MantineProvider } from "@mantine/core";
import type {
  PrdBreakdownEpic,
  PrdBreakdownReport,
} from "@merge-mentor/core/review/prd/breakdownReport.js";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PrdBreakdownSummary } from "../server/prd.types.js";

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

const { PrdBreakdownResult } = await import("./PrdBreakdownResult.js");

function renderHtml(ui: ReactNode): string {
  return renderToStaticMarkup(<MantineProvider>{ui}</MantineProvider>);
}

const EPICS: PrdBreakdownEpic[] = [
  {
    number: "1",
    title: "Guest checkout",
    goal: "Shoppers pay without an account.",
    rationale: "Everything builds on checkout.",
    dependsOn: [],
    features: [
      {
        number: "1.1",
        title: "Guest form",
        description: "Collects shipping details.",
        pbis: [
          {
            number: "1.1.1",
            title: "Guest can enter an address",
            description: "As a guest I want to give an address.",
            acceptanceCriteria: ["The form asks for street and city."],
            dependsOn: [],
            sectionId: "s2",
            headingPath: ["Goals"],
            quote: "Guests can pay without an account.",
            quoteVerified: true,
          },
        ],
      },
    ],
  },
  {
    number: "2",
    title: "Saved cards",
    goal: "",
    rationale: "",
    dependsOn: ["1"],
    features: [
      {
        number: "2.1",
        title: "Card vault",
        description: "",
        pbis: [
          {
            number: "2.1.1",
            title: "Shopper can reuse a card",
            description: "",
            acceptanceCriteria: [],
            dependsOn: ["1.1.1"],
            sectionId: "",
            headingPath: [],
            quote: "",
            quoteVerified: false,
          },
        ],
      },
    ],
  },
];

function buildSummary(overrides: Partial<PrdBreakdownReport> = {}): PrdBreakdownSummary {
  const report: PrdBreakdownReport = {
    schemaVersion: 1,
    kind: "prd-breakdown",
    runId: "run-1",
    createdAt: "2026-10-23T12:00:00.000Z",
    documentType: "prd",
    source: { fileName: "Checkout.docx" },
    document: { title: "Checkout", chunkCount: 1, processedChunkCount: 1 },
    summary: "Guests first, then saved cards.",
    ordered: true,
    complete: true,
    counts: { epics: 2, features: 2, pbis: 2 },
    epics: EPICS,
    openQuestions: [],
    uncoveredSections: [],
    notes: [],
    version: "1.0.0",
    ...overrides,
  };
  return {
    prdRunId: "run-1",
    reportName: "prd-run-1-breakdown.md",
    report,
    reportMarkdown: "# Work breakdown: Checkout",
  };
}

describe("PrdBreakdownResult", () => {
  it("shows the counts, the delivery order summary and the tree in order", () => {
    const html = renderHtml(<PrdBreakdownResult summary={buildSummary()} />);

    expect(html).toContain("Work breakdown");
    expect(html).toContain("Checkout · Checkout.docx");
    expect(html).toContain("2 epics");
    expect(html).toContain("2 features");
    expect(html).toContain("2 PBIs");
    expect(html).toContain("Guests first, then saved cards.");
    expect(html.indexOf("Guest checkout")).toBeLessThan(html.indexOf("Saved cards"));
    expect(html).toContain("Epic 1");
    expect(html).toContain("Feature 1.1");
    expect(html).toContain("PBI 1.1.1");
    expect(html).toContain("Guest can enter an address");
  });

  it("keeps PBIs closed until opened, and shows their details when open", () => {
    const closed = renderHtml(<PrdBreakdownResult summary={buildSummary()} />);
    expect(closed).toContain("Expand all");
    expect(closed).not.toContain("The form asks for street and city.");

    const open = renderHtml(<PrdBreakdownResult summary={buildSummary()} expanded />);
    expect(open).toContain("Collapse all");
    expect(open).toContain("The form asks for street and city.");
  });

  it("shows what a PBI needs, its criteria and where it comes from", () => {
    const html = renderHtml(<PrdBreakdownResult summary={buildSummary()} expanded />);

    expect(html).toContain("Shoppers pay without an account.");
    expect(html).toContain("Everything builds on checkout.");
    expect(html).toContain("The form asks for street and city.");
    expect(html).toContain("From the document: Goals");
    expect(html).toContain("Guests can pay without an account.");
    // Saved cards needs the first epic; its PBI needs PBI 1.1.1 and has no source.
    expect(html).toContain("Needs first");
    expect(html).toContain("needs 1");
    expect(html).toContain("source not found");
    expect(html).toContain("From the document: Document");
  });

  it("offers the Markdown as a download and a copy, and links to the report", () => {
    const html = renderHtml(<PrdBreakdownResult summary={buildSummary()} />);

    expect(html).toContain("Download Markdown");
    expect(html).toContain("Copy Markdown");
    expect(html).toContain("/reports?report=prd-run-1-breakdown.md");
  });

  it("lists open questions, uncovered sections and notes", () => {
    const html = renderHtml(
      <PrdBreakdownResult
        summary={buildSummary({
          openQuestions: [{ question: "How long are cards kept?", headingPath: ["Goals"] }],
          uncoveredSections: [{ sectionId: "s1", headingPath: ["Overview"] }],
          notes: ["One dependency was left out."],
        })}
      />
    );

    expect(html).toContain("Open questions");
    expect(html).toContain("How long are cards kept?");
    expect(html).toContain("These sections have text but produced no work items.");
    expect(html).toContain("Overview");
    expect(html).toContain("One dependency was left out.");
    expect(html).not.toContain("Every part of the document with text produced");
  });

  it("warns when the breakdown is unordered or partial", () => {
    const html = renderHtml(
      <PrdBreakdownResult summary={buildSummary({ ordered: false, complete: false })} />
    );

    expect(html).toContain("not ordered");
    expect(html).toContain("partly covered");
    expect(html).toContain("follow the order of");
    expect(html).toContain("Some parts of the document could not be processed.");
  });

  it("says so when no work items could be drawn from the document", () => {
    const html = renderHtml(
      <PrdBreakdownResult
        summary={buildSummary({ epics: [], counts: { epics: 0, features: 0, pbis: 0 } })}
      />
    );

    expect(html).toContain("No work items could be drawn from the document.");
    expect(html).not.toContain("Expand all");
    expect(html).not.toContain("Collapse all");
  });
});
