import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { MergeMentorError, ValidationError } from "@merge-mentor/shared/errors/index.js";
import { createFixedClock } from "@merge-mentor/shared/ports/clock.test-helper.js";
import { createCapturingOutputWriter } from "@merge-mentor/shared/ports/outputWriter.test-helper.js";
import { prdRunPaths } from "@merge-mentor/shared/reports/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AIResponse, ExecutePromptOptions } from "../../ai/types.js";
import type { ReviewProgressEvent } from "../progress.js";
import { type PrdBreakdownOptions, runPrdBreakdown } from "./breakdownEngine.js";
import { buildDocx, heading, para, paraXml } from "./docxFixture.test-helper.js";
import { createFakeAIClient, jsonResponse } from "./prdAi.test-helper.js";

const CLOCK = createFixedClock("2026-10-23T14:25:30.000Z");

async function fixtureDocx(): Promise<Buffer> {
  return buildDocx({
    body: [
      paraXml('<w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Checkout PRD</w:t></w:r>'),
      heading(1, "Overview"),
      para(
        "Shoppers abandon checkout because it takes too long, and support hears about it every week from our biggest customers."
      ),
      heading(1, "Goals"),
      para("Guests can pay without creating an account."),
      para("Saved cards are reused on the next order."),
      heading(1, "Scope"),
      para(
        "The first release covers card payments for logged-in shoppers and guests, including receipts by email."
      ),
    ].join(""),
  });
}

type Handler = (prompt: string, options: ExecutePromptOptions | undefined) => AIResponse;

const EXTRACT_GOALS = {
  epics: [
    {
      title: "Saved payment methods",
      goal: "Returning shoppers pay faster.",
      features: [
        {
          title: "Card vault",
          description: "Stores cards for later.",
          pbis: [
            {
              title: "Shopper can reuse a saved card",
              description: "As a shopper I want my card remembered.",
              acceptanceCriteria: ["The saved card is offered at checkout.", "  "],
              sectionId: "[s2]",
              quote: "Saved cards are reused on the next order.",
            },
          ],
        },
      ],
    },
    {
      title: "Guest checkout",
      goal: "Shoppers pay without an account.",
      features: [
        {
          title: "Guest payment",
          description: "Pay as a guest.",
          pbis: [
            {
              title: "Guest can pay by card",
              description: "As a guest I want to pay.",
              acceptanceCriteria: ["A guest completes payment without signing in."],
              sectionId: "s2",
              quote: "Guests can pay without creating an account.",
            },
            {
              title: "Made-up item",
              description: "",
              acceptanceCriteria: [],
              sectionId: "s2",
              quote: "This sentence is not in the document.",
            },
            { title: "  ", description: "", acceptanceCriteria: [], sectionId: "s2", quote: "" },
          ],
        },
      ],
    },
  ],
  openQuestions: [
    {
      question: "How long are saved cards kept?",
      sectionId: "s2",
      quote: "Saved cards are reused on the next order.",
    },
    { question: "How long are saved cards kept?", sectionId: "s2", quote: "" },
    { question: "   ", sectionId: "s2", quote: "" },
  ],
};

/** An ordering answer that uses null for every list the model had nothing for. */
const ORGANIZE_NULLS = {
  summary: null,
  epics: [
    {
      title: "Guest checkout",
      goal: null,
      rationale: null,
      epicIds: null,
      features: [
        { title: "Guest payment", description: null, featureIds: null, pbiIds: ["P1", "P2"] },
        { title: "Receipts", description: null, featureIds: null, pbiIds: ["P3", "P4"] },
      ],
    },
  ],
  dependencies: null,
  gaps: null,
};

const EXTRACT_SCOPE = {
  epics: [
    {
      title: "guest checkout",
      goal: "",
      features: [
        {
          title: "Receipts",
          description: "Email receipts.",
          pbis: [
            {
              title: "Guest receives an emailed receipt",
              description: "",
              acceptanceCriteria: ["A receipt is emailed after payment."],
              sectionId: "s3",
              quote: "including receipts by email",
            },
          ],
        },
      ],
    },
  ],
  openQuestions: [],
};

/** Default AI behaviour: items from Goals and Scope; the ordering puts guests first. */
const defaultHandler: Handler = (prompt, options) => {
  switch (options?.promptType) {
    case "prd-breakdown-extract":
      if (prompt.includes("Goals [s2]")) return jsonResponse(EXTRACT_GOALS);
      if (prompt.includes("Scope [s3]")) return jsonResponse(EXTRACT_SCOPE);
      return jsonResponse({ epics: [], openQuestions: [] });
    case "prd-breakdown-organize":
      return jsonResponse({
        summary: "Guests first, then saved cards.",
        epics: [
          {
            title: "Guest checkout",
            goal: "",
            rationale: "Everything else builds on a working checkout.",
            epicIds: ["E2", "E3"],
            features: [
              {
                title: "Guest payment",
                description: "",
                featureIds: ["F2"],
                pbiIds: ["[P2]", "P2"],
              },
              { title: "Receipts", description: "", featureIds: ["F3"], pbiIds: ["P4", "P99"] },
            ],
          },
          {
            title: "Saved payment methods",
            goal: "Returning shoppers pay faster.",
            rationale: "Needs payments to exist first.",
            epicIds: ["E1"],
            features: [{ title: "", description: "", featureIds: ["F1"], pbiIds: ["P1"] }],
          },
        ],
        dependencies: [
          { pbiId: "P1", dependsOn: ["P2", "P1", "P77"] },
          { pbiId: "P2", dependsOn: ["P1"] },
          { pbiId: "P4", dependsOn: ["P2"] },
        ],
        gaps: ["Refunds are not described.", ""],
      });
    default:
      throw new Error(`unexpected prompt type ${String(options?.promptType)}`);
  }
};

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false
  );
}

describe("runPrdBreakdown", () => {
  let tempPath: string;
  let docxPath: string;

  beforeEach(async () => {
    tempPath = await mkdtemp(path.join(tmpdir(), "prd-breakdown-spec-"));
    docxPath = path.join(tempPath, "Checkout PRD.docx");
    await writeFile(docxPath, await fixtureDocx());
  });

  afterEach(async () => {
    await rm(tempPath, { recursive: true, force: true });
  });

  function options(overrides: Partial<PrdBreakdownOptions> = {}): PrdBreakdownOptions {
    return {
      source: { path: docxPath },
      tempPath,
      runId: "run-1",
      aiProvider: "copilot-sdk",
      aiModel: "test-model",
      chunkOptions: { minChars: 0 },
      output: createCapturingOutputWriter(),
      ...overrides,
    };
  }

  it("breaks a document down into numbered epics, features and PBIs in delivery order", async () => {
    const client = createFakeAIClient(defaultHandler);
    const result = await runPrdBreakdown(options(), { aiClient: client, clock: CLOCK });

    const { report } = result;
    expect(report.kind).toBe("prd-breakdown");
    expect(report.runId).toBe("run-1");
    expect(report.documentType).toBe("prd");
    expect(report.ordered).toBe(true);
    expect(report.complete).toBe(true);
    expect(report.summary).toBe("Guests first, then saved cards.");
    // Includes the “Needs placement” group for the item the ordering step missed.
    expect(report.counts).toEqual({ epics: 3, features: 4, pbis: 4 });
    expect(report.createdAt).toBe("2026-10-23T14:25:30.000Z");
    expect(report.source.fileName).toBe("Checkout PRD.docx");
    expect(report.document.title).toBe("Checkout PRD");

    const [guest, saved] = report.epics;
    expect(guest?.number).toBe("1");
    expect(guest?.title).toBe("Guest checkout");
    // The model left the goal blank, so the merged epics supply it.
    expect(guest?.goal).toBe("Shoppers pay without an account.");
    expect(guest?.features.map((feature) => [feature.number, feature.title])).toEqual([
      ["1.1", "Guest payment"],
      ["1.2", "Receipts"],
    ]);
    expect(saved?.features[0]?.title).toBe("Card vault");

    const pbis = report.epics.flatMap((epic) => epic.features.flatMap((feature) => feature.pbis));
    expect(pbis.map((pbi) => [pbi.number, pbi.title])).toEqual([
      ["1.1.1", "Guest can pay by card"],
      ["1.2.1", "Guest receives an emailed receipt"],
      ["2.1.1", "Shopper can reuse a saved card"],
      // Not placed by the ordering step, so listed last for the author to place.
      ["3.1.1", "Made-up item"],
    ]);
    expect(report.epics[2]?.title).toBe("Needs placement");
  });

  it("treats null text from the model as empty, not as the word null", async () => {
    const client = createFakeAIClient((prompt, opts) => {
      if (opts?.promptType === "prd-breakdown-extract" && prompt.includes("Goals [s2]")) {
        return jsonResponse({
          epics: [
            {
              title: "Guest checkout",
              goal: null,
              features: [
                {
                  title: "Guest payment",
                  description: null,
                  pbis: [
                    {
                      title: "Guest can pay by card",
                      description: null,
                      acceptanceCriteria: [null, "A guest pays."],
                      sectionId: null,
                      quote: "Guests can pay without creating an account.",
                    },
                  ],
                },
              ],
            },
          ],
          openQuestions: [],
        });
      }
      if (opts?.promptType === "prd-breakdown-extract") {
        return jsonResponse({ epics: [], openQuestions: [] });
      }
      return jsonResponse({
        summary: null,
        epics: [
          {
            title: null,
            goal: null,
            rationale: null,
            epicIds: ["E1"],
            features: [{ title: null, description: null, featureIds: ["F1"], pbiIds: ["P1"] }],
          },
        ],
        dependencies: [],
        gaps: [],
      });
    });
    const result = await runPrdBreakdown(options(), { aiClient: client, clock: CLOCK });
    const [epic] = result.report.epics;
    // Blank titles fall back to the items that were merged.
    expect(epic?.title).toBe("Guest checkout");
    expect(epic?.goal).toBe("");
    expect(epic?.features[0]?.title).toBe("Guest payment");
    expect(epic?.features[0]?.pbis[0]).toMatchObject({
      description: "",
      acceptanceCriteria: ["A guest pays."],
      quoteVerified: true,
    });
    expect(result.report.summary).toBe("");
    expect(result.reportMarkdown).not.toContain("null");
  });

  it("keeps the work items of a part whose lists are null or whose open questions are missing", async () => {
    const client = createFakeAIClient((prompt, opts) => {
      if (opts?.promptType === "prd-breakdown-extract" && prompt.includes("Goals [s2]")) {
        // No openQuestions at all.
        return jsonResponse({ epics: EXTRACT_GOALS.epics });
      }
      if (opts?.promptType === "prd-breakdown-extract" && prompt.includes("Scope [s3]")) {
        return jsonResponse({
          epics: [{ title: "Receipts", goal: "", features: null }, ...EXTRACT_SCOPE.epics],
          openQuestions: null,
        });
      }
      if (opts?.promptType === "prd-breakdown-extract") {
        return jsonResponse({ epics: null, openQuestions: null });
      }
      return jsonResponse({ ...JSON.parse(JSON.stringify(ORGANIZE_NULLS)) });
    });
    const result = await runPrdBreakdown(options(), { aiClient: client, clock: CLOCK });
    // Nothing was lost to a failed part, and null lists in the ordering answer mean "none".
    expect(result.report.complete).toBe(true);
    expect(result.report.ordered).toBe(true);
    expect(result.report.counts.pbis).toBe(4);
    expect(result.report.notes.join(" ")).not.toContain("AI request failed");
  });

  it("credits a quote to the section the model cited when the phrase appears in two", async () => {
    const docx = await buildDocx({
      body: [
        heading(1, "Overview"),
        para("Guests can pay by card at checkout."),
        heading(1, "Details"),
        para("Guests can pay by card at checkout, with a receipt by email."),
      ].join(""),
    });
    await writeFile(docxPath, docx);
    const client = createFakeAIClient((prompt, opts) => {
      if (opts?.promptType === "prd-breakdown-extract") {
        return jsonResponse({
          epics: [
            {
              title: "Payments",
              goal: "",
              features: [
                {
                  title: "Card",
                  description: "",
                  pbis: [
                    {
                      title: "Guest can pay by card",
                      description: "",
                      acceptanceCriteria: [],
                      sectionId: "s2",
                      quote: "Guests can pay by card at checkout",
                    },
                  ],
                },
              ],
            },
          ],
          openQuestions: [],
        });
      }
      return jsonResponse({ nope: true });
    });
    const result = await runPrdBreakdown(options({ chunkOptions: { minChars: 100_000 } }), {
      aiClient: client,
      clock: CLOCK,
    });
    // One chunk holds both sections; the phrase is in each, and the cited one wins.
    const pbi = result.report.epics[0]?.features[0]?.pbis[0];
    expect(pbi).toMatchObject({ sectionId: "s2", headingPath: ["Details"], quoteVerified: true });
  });

  it("grounds each PBI in the document and flags a quote that cannot be found", async () => {
    const result = await runPrdBreakdown(options(), {
      aiClient: createFakeAIClient(defaultHandler),
      clock: CLOCK,
    });
    const pbis = result.report.epics.flatMap((epic) =>
      epic.features.flatMap((feature) => feature.pbis)
    );
    const guest = pbis.find((pbi) => pbi.title === "Guest can pay by card");
    expect(guest).toMatchObject({
      sectionId: "s2",
      headingPath: ["Goals"],
      quoteVerified: true,
      acceptanceCriteria: ["A guest completes payment without signing in."],
    });
    expect(guest?.paragraphId).toMatch(/^p\d+$/);
    expect(pbis.find((pbi) => pbi.title === "Shopper can reuse a saved card")).toMatchObject({
      sectionId: "s2",
      quoteVerified: true,
      // Blank criteria are dropped.
      acceptanceCriteria: ["The saved card is offered at checkout."],
    });
    const madeUp = pbis.find((pbi) => pbi.title === "Made-up item");
    expect(madeUp?.quoteVerified).toBe(false);
    expect(result.reportMarkdown).toContain(
      "The text this item is based on could not be found in the document."
    );
  });

  it("keeps only dependencies on real PBIs that come earlier in the order", async () => {
    const result = await runPrdBreakdown(options(), {
      aiClient: createFakeAIClient(defaultHandler),
      clock: CLOCK,
    });
    const byTitle = new Map(
      result.report.epics.flatMap((epic) =>
        epic.features.flatMap((feature) => feature.pbis.map((pbi) => [pbi.title, pbi] as const))
      )
    );
    // P1 (saved card) depends on P2 (guest pay); its self and unknown dependencies are dropped.
    expect(byTitle.get("Shopper can reuse a saved card")?.dependsOn).toEqual(["1.1.1"]);
    // P2 -> P1 points at a later item, so it is dropped.
    expect(byTitle.get("Guest can pay by card")?.dependsOn).toEqual([]);
    expect(byTitle.get("Guest receives an emailed receipt")?.dependsOn).toEqual(["1.1.1"]);
    expect(result.report.epics[1]?.dependsOn).toEqual(["1"]);
    expect(result.report.epics[0]?.dependsOn).toEqual([]);
    expect(result.report.notes.join(" ")).toContain("3 dependencies were left out");
    expect(result.report.notes.join(" ")).toContain("1 work item was not placed");
  });

  it("collects open questions without duplicates and adds the gaps from the ordering step", async () => {
    const result = await runPrdBreakdown(options(), {
      aiClient: createFakeAIClient(defaultHandler),
      clock: CLOCK,
    });
    expect(result.report.openQuestions).toEqual([
      {
        question: "How long are saved cards kept?",
        sectionId: "s2",
        headingPath: ["Goals"],
        quote: "Saved cards are reused on the next order.",
      },
      { question: "Refunds are not described.", headingPath: [] },
    ]);
  });

  it("lists sections that have text but produced no work items", async () => {
    const result = await runPrdBreakdown(options(), {
      aiClient: createFakeAIClient(defaultHandler),
      clock: CLOCK,
    });
    // "Overview" has text, but no work item points at it.
    expect(result.report.uncoveredSections).toEqual([
      { sectionId: "s1", headingPath: ["Overview"] },
    ]);
    expect(result.reportMarkdown).toContain("These sections have text but produced no work items.");
  });

  it("writes the Markdown and JSON breakdown next to the run", async () => {
    const result = await runPrdBreakdown(options(), {
      aiClient: createFakeAIClient(defaultHandler),
      clock: CLOCK,
    });
    const paths = prdRunPaths(tempPath, "run-1");
    expect(result.paths).toEqual(paths);
    const markdown = await readFile(paths.breakdownMarkdown, "utf-8");
    expect(markdown).toBe(result.reportMarkdown);
    expect(markdown).toContain("# Work breakdown: Checkout PRD");
    expect(markdown).toContain("## Epic 1: Guest checkout");
    expect(markdown).toContain("#### PBI 1.1.1: Guest can pay by card");
    expect(markdown).toContain("- [ ] A guest completes payment without signing in.");
    expect(markdown).toContain("**Depends on:** PBI 1.1.1");
    expect(markdown).toContain("<!-- merge-mentor-prd-breakdown -->");
    const json = JSON.parse(await readFile(paths.breakdownJson, "utf-8")) as {
      kind: string;
      counts: { pbis: number };
    };
    expect(json.kind).toBe("prd-breakdown");
    expect(json.counts.pbis).toBe(4);
    expect(await exists(paths.sourceDocx)).toBe(true);
    expect(await exists(paths.documentJson)).toBe(true);
  });

  it("sends the document to the model only inside the untrusted wrapper and keeps session data off", async () => {
    const client = createFakeAIClient(defaultHandler);
    await runPrdBreakdown(options(), { aiClient: client, clock: CLOCK });
    const extractCalls = client.executePrompt.mock.calls.filter(
      ([, opts]) => (opts as ExecutePromptOptions).promptType === "prd-breakdown-extract"
    );
    expect(extractCalls.length).toBeGreaterThan(1);
    for (const [prompt, opts] of client.executePrompt.mock.calls as [
      string,
      ExecutePromptOptions,
    ][]) {
      expect(prompt).toContain("<untrusted-");
      expect(opts.discardSession).toBe(true);
      expect(opts.transcriptDir).toBe(path.resolve(prdRunPaths(tempPath, "run-1").transcriptsDir));
    }
  });

  it("groups the items in document order when the ordering step fails", async () => {
    const client = createFakeAIClient((prompt, opts) => {
      if (opts?.promptType === "prd-breakdown-organize") return jsonResponse({ nope: true });
      return defaultHandler(prompt, opts);
    });
    const result = await runPrdBreakdown(options(), { aiClient: client, clock: CLOCK });
    const { report } = result;
    expect(report.ordered).toBe(false);
    expect(report.summary).toBe("");
    // "Guest checkout" (Goals) and "guest checkout" (Scope) are the same epic.
    expect(report.epics.map((epic) => epic.title)).toEqual([
      "Saved payment methods",
      "Guest checkout",
    ]);
    expect(report.epics[1]?.features.map((feature) => feature.title)).toEqual([
      "Guest payment",
      "Receipts",
    ]);
    expect(report.counts.pbis).toBe(4);
    expect(result.reportMarkdown).toContain("**Not ordered.**");
  });

  it("keeps the document order when there are too many items to order in one request", async () => {
    const many = {
      epics: [
        {
          title: "Everything",
          goal: "",
          features: [
            {
              title: "All of it",
              description: "",
              pbis: Array.from({ length: 601 }, (_, number) => ({
                title: `Item ${number}`,
                description: "",
                acceptanceCriteria: [],
                sectionId: "s2",
                quote: "Guests can pay without creating an account.",
              })),
            },
          ],
        },
      ],
      openQuestions: [],
    };
    const client = createFakeAIClient((prompt, opts) =>
      opts?.promptType === "prd-breakdown-extract" && prompt.includes("Goals [s2]")
        ? jsonResponse(many)
        : opts?.promptType === "prd-breakdown-extract"
          ? jsonResponse({ epics: [], openQuestions: [] })
          : defaultHandler(prompt, opts)
    );
    const result = await runPrdBreakdown(options(), { aiClient: client, clock: CLOCK });
    expect(result.report.ordered).toBe(false);
    expect(result.report.counts.pbis).toBe(601);
    expect(
      client.executePrompt.mock.calls.some(
        ([, opts]) => (opts as ExecutePromptOptions).promptType === "prd-breakdown-organize"
      )
    ).toBe(false);
  });

  it("reports parts that could not be read and stays usable", async () => {
    const client = createFakeAIClient((prompt, opts) => {
      if (opts?.promptType === "prd-breakdown-extract" && prompt.includes("Scope [s3]")) {
        throw new Error("boom");
      }
      return defaultHandler(prompt, opts);
    });
    const result = await runPrdBreakdown(options(), { aiClient: client, clock: CLOCK });
    expect(result.report.complete).toBe(false);
    expect(result.report.notes.join(" ")).toContain("“Scope”: no work items were drawn");
    expect(result.reportMarkdown).toContain("**Partial breakdown.**");
    // Scope is unread, so it is not blamed as "produced nothing".
    expect(result.report.uncoveredSections.map((section) => section.sectionId)).not.toContain("s3");
  });

  it("lists parts beyond the chunk limit as not read", async () => {
    const result = await runPrdBreakdown(options({ maxChunks: 1 }), {
      aiClient: createFakeAIClient(defaultHandler),
      clock: CLOCK,
    });
    expect(result.report.complete).toBe(false);
    expect(result.report.notes.join(" ")).toContain("longer than the limit of 1 parts");
  });

  it("fails and removes a new run when no part could be read", async () => {
    const client = createFakeAIClient(() => {
      throw new Error("provider down");
    });
    await expect(runPrdBreakdown(options(), { aiClient: client, clock: CLOCK })).rejects.toThrow(
      MergeMentorError
    );
    const paths = prdRunPaths(tempPath, "run-1");
    expect(await exists(paths.runDir)).toBe(false);
    expect(await exists(paths.breakdownMarkdown)).toBe(false);
  });

  it("does not reuse the id of an existing run, so it cannot overwrite or delete it", async () => {
    const paths = prdRunPaths(tempPath, "run-1");
    await mkdir(paths.runDir, { recursive: true });
    await writeFile(paths.documentJson, "existing review data");
    const client = createFakeAIClient(defaultHandler);

    await expect(runPrdBreakdown(options(), { aiClient: client })).rejects.toThrow(
      "a run with the id run-1 already exists"
    );
    expect(client.executePrompt).not.toHaveBeenCalled();
    expect(await readFile(paths.documentJson, "utf-8")).toBe("existing review data");
    expect(await exists(paths.runDir)).toBe(true);

    // An unsafe id is refused too, before anything is written.
    await expect(runPrdBreakdown(options({ runId: "../x" }), { aiClient: client })).rejects.toThrow(
      ValidationError
    );
  });

  it("reports progress through phases and steps", async () => {
    const events: ReviewProgressEvent[] = [];
    await runPrdBreakdown(options({ onProgress: (event) => events.push(event) }), {
      aiClient: createFakeAIClient(defaultHandler),
      clock: CLOCK,
    });
    const phases = events
      .filter((event) => event.kind === "phase" && event.status === "start")
      .map((event) => (event.kind === "phase" ? event.id : ""));
    expect(phases).toEqual(["resolve", "fetch", "ai-review", "organize", "report"]);
    expect(
      events.some((event) => event.kind === "step" && event.status === "done" && event.detail)
    ).toBe(true);
  });

  async function storeReview(verdict: string, documentType: "prd" | "frd" = "prd"): Promise<void> {
    // Make the run's document, then add the review report a review would have written.
    await runPrdBreakdown(options({ documentType }), {
      aiClient: createFakeAIClient(defaultHandler),
      clock: CLOCK,
    });
    const paths = prdRunPaths(tempPath, "run-1");
    await rm(paths.breakdownMarkdown);
    await rm(paths.breakdownJson);
    await mkdir(path.dirname(paths.reportJson), { recursive: true });
    await writeFile(
      paths.reportJson,
      JSON.stringify({
        documentType,
        source: { fileName: "Checkout PRD.docx", sha256: "abc" },
        readiness: { verdict },
      })
    );
  }

  describe("from a stored run", () => {
    it("reuses the stored document without reading the file again", async () => {
      await storeReview("needs-work", "frd");
      await rm(docxPath);
      const client = createFakeAIClient(defaultHandler);
      const result = await runPrdBreakdown(options({ source: { fromRun: "run-1" } }), {
        aiClient: client,
        clock: CLOCK,
      });
      expect(result.runId).toBe("run-1");
      expect(result.report.documentType).toBe("frd");
      expect(result.report.review).toEqual({ verdict: "needs-work" });
      expect(result.report.source).toEqual({ fileName: "Checkout PRD.docx", sha256: "abc" });
      expect(result.report.counts.pbis).toBe(4);
      expect(result.reportMarkdown).toContain("not ready for development");
      expect(await exists(result.paths.breakdownMarkdown)).toBe(true);
    });

    it("keeps the type of a run made from a file when it has no review", async () => {
      // A direct breakdown of an FRD stores the document with its type but writes no review.
      await runPrdBreakdown(options({ documentType: "frd" }), {
        aiClient: createFakeAIClient(defaultHandler),
        clock: CLOCK,
      });
      expect(
        JSON.parse(await readFile(prdRunPaths(tempPath, "run-1").documentJson, "utf-8"))
      ).toMatchObject({ documentType: "frd" });

      const client = createFakeAIClient(defaultHandler);
      const again = await runPrdBreakdown(
        // The caller's default type must not override the stored one.
        options({ source: { fromRun: "run-1" }, documentType: "prd" }),
        { aiClient: client, clock: CLOCK }
      );
      expect(again.report.documentType).toBe("frd");
      expect(again.report.review).toBeUndefined();
      expect(String(client.executePrompt.mock.calls[0]?.[0])).toContain(
        "Functional Requirements Document"
      );
    });

    it("refuses a document whose review found blockers unless forced", async () => {
      await storeReview("not-ready");
      const client = createFakeAIClient(defaultHandler);
      await expect(
        runPrdBreakdown(options({ source: { fromRun: "run-1" } }), { aiClient: client })
      ).rejects.toThrow(ValidationError);
      expect(client.executePrompt).not.toHaveBeenCalled();
      // The review stays; nothing was written for the refused breakdown.
      expect(await exists(prdRunPaths(tempPath, "run-1").reportJson)).toBe(true);
      expect(await exists(prdRunPaths(tempPath, "run-1").breakdownMarkdown)).toBe(false);

      const forced = await runPrdBreakdown(options({ source: { fromRun: "run-1" }, force: true }), {
        aiClient: client,
        clock: CLOCK,
      });
      expect(forced.report.review).toEqual({ verdict: "not-ready" });
    });

    it("keeps the run and its review when the breakdown fails", async () => {
      await storeReview("ready");
      const client = createFakeAIClient(() => {
        throw new Error("provider down");
      });
      await expect(
        runPrdBreakdown(options({ source: { fromRun: "run-1" } }), { aiClient: client })
      ).rejects.toThrow(MergeMentorError);
      const paths = prdRunPaths(tempPath, "run-1");
      expect(await exists(paths.documentJson)).toBe(true);
      expect(await exists(paths.reportJson)).toBe(true);
      expect(await exists(paths.breakdownMarkdown)).toBe(false);
    });

    it("keeps an earlier breakdown when a later run fails or is refused", async () => {
      await storeReview("ready");
      const paths = prdRunPaths(tempPath, "run-1");
      await runPrdBreakdown(options({ source: { fromRun: "run-1" } }), {
        aiClient: createFakeAIClient(defaultHandler),
        clock: CLOCK,
      });
      const before = await readFile(paths.breakdownMarkdown, "utf-8");

      const failing = createFakeAIClient(() => {
        throw new Error("provider down");
      });
      await expect(
        runPrdBreakdown(options({ source: { fromRun: "run-1" } }), { aiClient: failing })
      ).rejects.toThrow(MergeMentorError);
      expect(await readFile(paths.breakdownMarkdown, "utf-8")).toBe(before);
      expect(await exists(paths.breakdownJson)).toBe(true);

      await writeFile(
        paths.reportJson,
        JSON.stringify({
          documentType: "prd",
          source: { fileName: "Checkout PRD.docx" },
          readiness: { verdict: "not-ready" },
        })
      );
      await expect(
        runPrdBreakdown(options({ source: { fromRun: "run-1" } }), { aiClient: failing })
      ).rejects.toThrow(ValidationError);
      expect(await readFile(paths.breakdownMarkdown, "utf-8")).toBe(before);
    });

    it("rejects an unsafe or unknown run id", async () => {
      const client = createFakeAIClient(defaultHandler);
      await expect(
        runPrdBreakdown(options({ source: { fromRun: "../etc" } }), { aiClient: client })
      ).rejects.toThrow(ValidationError);
      await expect(
        runPrdBreakdown(options({ source: { fromRun: "missing" } }), { aiClient: client })
      ).rejects.toThrow(/no stored document was found/);
      expect(client.executePrompt).not.toHaveBeenCalled();
    });

    it("says what is wrong with a stored document that exists but cannot be read", async () => {
      const paths = prdRunPaths(tempPath, "run-1");
      await mkdir(paths.runDir, { recursive: true });
      await writeFile(paths.documentJson, '{"document": {"sections": [');
      await expect(
        runPrdBreakdown(options({ source: { fromRun: "run-1" } }), {
          aiClient: createFakeAIClient(defaultHandler),
        })
      ).rejects.toThrow(/stored document for run run-1 is damaged/);

      // A directory where the file should be is another read failure, not a missing run.
      await rm(paths.documentJson);
      await mkdir(paths.documentJson);
      await expect(
        runPrdBreakdown(options({ source: { fromRun: "run-1" } }), {
          aiClient: createFakeAIClient(defaultHandler),
        })
      ).rejects.toThrow(/stored document for run run-1 could not be read/);
    });

    it("rejects a stored document whose parts are not the shape the breakdown needs", async () => {
      const paths = prdRunPaths(tempPath, "run-1");
      await mkdir(paths.runDir, { recursive: true });
      const sections = [{ id: "s1", level: 1, headingPath: ["A"], childIds: [], blocks: [] }];
      const chunk = { id: "c1", text: "x", sectionIds: ["s1"], headingPath: ["A"] };
      for (const stored of [
        { document: { sections, images: [] }, chunks: [{ ...chunk, sectionIds: undefined }] },
        { document: { sections: [{ id: "s1" }], images: [] }, chunks: [chunk] },
        { document: { sections, images: undefined }, chunks: [chunk] },
        { document: { sections, images: [] }, chunks: "none" },
      ]) {
        await writeFile(paths.documentJson, JSON.stringify(stored));
        await expect(
          runPrdBreakdown(options({ source: { fromRun: "run-1" } }), {
            aiClient: createFakeAIClient(defaultHandler),
          })
        ).rejects.toThrow(/not in a readable format/);
      }
    });

    it("says so when the review report exists but cannot be read", async () => {
      await storeReview("ready", "frd");
      const paths = prdRunPaths(tempPath, "run-1");
      await writeFile(paths.reportJson, "{ truncated");
      const output = createCapturingOutputWriter();
      const result = await runPrdBreakdown(
        options({ source: { fromRun: "run-1" }, output, documentType: "frd" }),
        { aiClient: createFakeAIClient(defaultHandler), clock: CLOCK }
      );
      expect(result.report.review).toBeUndefined();
      expect(result.report.documentType).toBe("frd");
      expect(output.output.map((entry) => entry.data).join("\n")).toContain(
        "The review report of this run could not be read"
      );
    });

    it("rejects a stored document it cannot read", async () => {
      const paths = prdRunPaths(tempPath, "run-1");
      await mkdir(paths.runDir, { recursive: true });
      await writeFile(paths.documentJson, JSON.stringify({ document: {}, chunks: [] }));
      await expect(
        runPrdBreakdown(options({ source: { fromRun: "run-1" } }), {
          aiClient: createFakeAIClient(defaultHandler),
        })
      ).rejects.toThrow(/not in a readable format/);
    });
  });
});
