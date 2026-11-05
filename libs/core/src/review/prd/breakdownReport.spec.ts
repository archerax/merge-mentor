import { describe, expect, it } from "vitest";

import {
  countBreakdown,
  type PrdBreakdownEpic,
  type PrdBreakdownReport,
  renderPrdBreakdownMarkdown,
} from "./breakdownReport.js";

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
            quote: "Guests can pay.\nSecond line.",
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

function report(overrides: Partial<PrdBreakdownReport> = {}): PrdBreakdownReport {
  return {
    schemaVersion: 1,
    kind: "prd-breakdown",
    runId: "run-1",
    createdAt: "2026-10-23T14:25:30.000Z",
    documentType: "prd",
    source: { fileName: "checkout.docx" },
    document: { title: "Checkout PRD", chunkCount: 2, processedChunkCount: 2 },
    summary: "Guests first, then saved cards.",
    ordered: true,
    complete: true,
    counts: countBreakdown(EPICS),
    epics: EPICS,
    openQuestions: [],
    uncoveredSections: [],
    notes: [],
    aiModel: "test-model",
    version: "1.2.3",
    ...overrides,
  };
}

describe("countBreakdown", () => {
  it("counts epics, features and PBIs", () => {
    expect(countBreakdown(EPICS)).toEqual({ epics: 2, features: 2, pbis: 2 });
    expect(countBreakdown([])).toEqual({ epics: 0, features: 0, pbis: 0 });
  });
});

describe("renderPrdBreakdownMarkdown", () => {
  it("renders the hierarchy with numbers, criteria checkboxes and dependencies", () => {
    const markdown = renderPrdBreakdownMarkdown(report());
    expect(markdown.startsWith("# Work breakdown: Checkout PRD\n")).toBe(true);
    expect(markdown).toContain("2 epics, 2 features, 2 PBIs, listed in the suggested order");
    expect(markdown).toContain("Guests first, then saved cards.");
    expect(markdown).toContain("## Suggested order");
    expect(markdown).toContain("1. **Guest checkout**\n   - 1.1 Guest form (1 PBI)");
    expect(markdown).toContain("## Epic 1: Guest checkout");
    expect(markdown).toContain("**Goal:** Shoppers pay without an account.");
    expect(markdown).toContain("**Why it is here:** Everything builds on checkout.");
    expect(markdown).toContain("**Needs first:** Epic 1");
    expect(markdown).toContain("### Feature 1.1: Guest form");
    expect(markdown).toContain("#### PBI 1.1.1: Guest can enter an address");
    expect(markdown).toContain("- [ ] The form asks for street and city.");
    expect(markdown).toContain("**Depends on:** PBI 1.1.1");
    expect(markdown).toContain("**From the document:** Goals");
    expect(markdown).toContain("> Guests can pay.\n> Second line.");
    expect(markdown).toContain(
      "Every part of the document with text produced at least one work item."
    );
    expect(markdown).toContain("<!-- merge-mentor-prd-breakdown -->");
  });

  it("warns about a missing quote, unordered and partial breakdowns and an unready review", () => {
    const markdown = renderPrdBreakdownMarkdown(
      report({
        ordered: false,
        complete: false,
        summary: "",
        review: { verdict: "needs-work" },
      })
    );
    expect(markdown).toContain("could not be found in the document");
    expect(markdown).toContain("**Not ordered.**");
    expect(markdown).toContain("**Partial breakdown.**");
    expect(markdown).toContain("not ready for development");
    expect(renderPrdBreakdownMarkdown(report({ review: { verdict: "ready" } }))).not.toContain(
      "not ready for development"
    );
  });

  it("keeps model text from adding headings, lists, rules or HTML to the document", () => {
    const [first] = EPICS;
    const hostile: PrdBreakdownEpic = {
      number: "1",
      title: "# Fake title\n## Epic 9: Fake",
      goal: "Goal\n## Epic 9: Fake goal",
      rationale: "- injected\n---",
      dependsOn: [],
      features: [
        {
          number: "1.1",
          title: "Feature <script>alert(1)</script>",
          description: "# Heading\n\n- item",
          pbis: [
            {
              number: "1.1.1",
              title: "1. Numbered",
              description: "Text\n\n## Epic 9: Fake\n<!-- hidden -->",
              acceptanceCriteria: ["> quote\n# heading"],
              dependsOn: [],
              sectionId: "s1",
              headingPath: ["# Section", "<b>x</b>"],
              quote:
                "Line one\n<img src=x>\n# not a heading\n![pixel](https://tracker.example/p.png)\n~~~\n[click](https://phish.example)",
              quoteVerified: true,
            },
          ],
        },
      ],
    };
    const markdown = renderPrdBreakdownMarkdown(
      report({
        epics: first ? [hostile] : [],
        summary: "Summary\n## Epic 9: Fake summary",
        notes: ["# Note\n---", "~~~\n# fenced", "[link](https://example.com)"],
        openQuestions: [{ question: "## Q?", headingPath: [] }],
      })
    );
    const headings = markdown.split("\n").filter((line) => /^#{1,6} /.test(line));
    expect(headings).toEqual([
      "# Work breakdown: Checkout PRD",
      "## Suggested order",
      "## Epic 1: \\# Fake title ## Epic 9: Fake",
      "### Feature 1.1: Feature &lt;script>alert(1)&lt;/script>",
      "#### PBI 1.1.1: \\1. Numbered",
      "## Open questions",
      "## Not covered",
      "## About this breakdown",
    ]);
    // Only the footer rule remains; injected rules are escaped.
    expect(markdown.split("\n").filter((line) => line === "---")).toHaveLength(1);
    expect(markdown).not.toContain("<script>");
    expect(markdown).not.toContain("<img");
    expect(markdown).not.toContain("<b>");
    expect(markdown).not.toContain("<!-- hidden -->");
    expect(markdown).toContain("> Line one\n> &lt;img src=x>\n> # not a heading");
    // Tilde fences cannot open, and links and images are plain text.
    expect(markdown.split("\n").some((line) => /^(?:~{3,}|`{3,})/.test(line))).toBe(false);
    expect(markdown).not.toContain("![pixel]");
    expect(markdown).not.toContain("[click]");
    expect(markdown).toContain("!\\[pixel\\](https://tracker.example/p.png)");
    expect(markdown).toContain("\\[click\\](https://phish.example)");
  });

  it("lists open questions, uncovered sections and notes", () => {
    const markdown = renderPrdBreakdownMarkdown(
      report({
        openQuestions: [
          { question: "How long are cards kept?", headingPath: ["Goals", "Cards"] },
          { question: "Refunds?", headingPath: [] },
        ],
        uncoveredSections: [{ sectionId: "s1", headingPath: ["Overview"] }],
        notes: ["One dependency was left out."],
      })
    );
    expect(markdown).toContain("## Open questions");
    expect(markdown).toContain("- How long are cards kept? _(Goals › Cards)_");
    expect(markdown).toContain("- Refunds?\n");
    expect(markdown).toContain("These sections have text but produced no work items.");
    expect(markdown).toContain("- Overview");
    expect(markdown).toContain("- One dependency was left out.");
  });

  it("says so when nothing could be drawn from the document", () => {
    const markdown = renderPrdBreakdownMarkdown(
      report({ epics: [], counts: { epics: 0, features: 0, pbis: 0 } })
    );
    expect(markdown).toContain("0 epics, 0 features, 0 PBIs");
    expect(markdown).toContain("No work items could be drawn from the document.");
    expect(markdown).not.toContain("## Suggested order");
  });

  it("falls back to the file name for the title and uses singular counts", () => {
    const [first] = EPICS;
    const single = first ? [first] : [];
    const markdown = renderPrdBreakdownMarkdown(
      report({
        document: { chunkCount: 1, processedChunkCount: 1 },
        epics: single,
        counts: { epics: 1, features: 1, pbis: 1 },
        aiModel: undefined,
      })
    );
    expect(markdown).toContain("# Work breakdown: checkout.docx");
    expect(markdown).toContain("1 epic, 1 feature, 1 PBI,");
    expect(markdown).toContain("PRD work breakdown, AI model");
  });
});
