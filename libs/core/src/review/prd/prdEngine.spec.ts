import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DocumentParseError,
  MergeMentorError,
  ValidationError,
} from "@merge-mentor/shared/errors/index.js";
import { createFixedClock } from "@merge-mentor/shared/ports/clock.test-helper.js";
import { createCapturingOutputWriter } from "@merge-mentor/shared/ports/outputWriter.test-helper.js";
import { deletePrdRun, listReports } from "@merge-mentor/shared/reports/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AIResponse, ExecutePromptOptions } from "../../ai/types.js";
import type { ReviewProgressEvent } from "../progress.js";
import {
  buildDocx,
  heading,
  imageRun,
  para,
  paraXml,
  TINY_PNG,
} from "./docxFixture.test-helper.js";
import { createFakeAIClient, jsonResponse } from "./prdAi.test-helper.js";
import {
  type PrdReviewOptions,
  type PrdReviewReport,
  type PrdReviewSource,
  runPrdReview,
} from "./prdEngine.js";

const CLOCK = createFixedClock("2026-10-23T14:25:30.000Z");

async function fixtureDocx(): Promise<Buffer> {
  return buildDocx({
    body: [
      paraXml('<w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Checkout PRD</w:t></w:r>'),
      heading(1, "Overview"),
      para("Shoppers abandon checkout because it takes too long."),
      heading(1, "Goals"),
      para("Checkout must be fast."),
      para("Conversion should improve."),
      heading(1, "Scope"),
      para("Card payments are in scope."),
      paraXml(imageRun("rIdImg1", "Checkout flow diagram")),
      heading(1, "Out of scope"),
      para("Card payments are out of scope for phase one."),
    ].join(""),
    images: [{ relId: "rIdImg1", fileName: "image1.png", data: TINY_PNG }],
  });
}

type Handler = (prompt: string, options: ExecutePromptOptions | undefined) => AIResponse;

/** Default AI behaviour: one real and one made-up finding per pass, verifier keeps all. */
const defaultHandler: Handler = (prompt, options) => {
  switch (options?.promptType) {
    case "prd-section":
      if (prompt.includes("Goals [s2]")) {
        return jsonResponse({
          summary: "States the goals.",
          keyStatements: ["Checkout must be fast."],
          findings: [
            {
              severity: "Major",
              dimension: "ambiguity",
              sectionId: "[s2]",
              quote: "Checkout must be fast.",
              problem: "“Fast” cannot be checked. Testers will not know when it is done.",
              suggestion: "Say “Checkout completes within 3 seconds for 95% of shoppers.”",
              authorQuestion: "What checkout time are you aiming for?",
            },
            {
              severity: "Blocker",
              dimension: "problem-users-goals",
              sectionId: "s2",
              quote: "Checkout must load in 2 seconds.",
              problem: "Made up.",
              suggestion: "",
            },
            {
              severity: "Minor",
              dimension: "made-up-dimension",
              sectionId: "s2",
              quote: "Conversion should improve.",
              problem: "No target is given.",
              suggestion: "Add a target.",
            },
            {
              severity: "Minor",
              dimension: "scope",
              sectionId: "s2",
              quote: "Conversion should improve.",
              problem: "   ",
              suggestion: "",
            },
          ],
        });
      }
      return jsonResponse({ summary: "Other section.", keyStatements: [], findings: [] });
    case "prd-consistency":
      return jsonResponse({
        readiness: { verdict: "not-ready", summary: "Scope contradicts itself." },
        findings: [
          {
            severity: "Blocker",
            dimension: "ambiguity",
            sectionId: "s3",
            quote: "Card payments are out of scope for phase one.",
            problem: "Scope says card payments are in, Out of scope says they are out.",
            suggestion: "Decide and remove one statement.",
          },
        ],
      });
    case "prd-verify":
      return jsonResponse({ verdicts: [] });
    default:
      throw new Error(`unexpected prompt type ${String(options?.promptType)}`);
  }
};

describe("runPrdReview", () => {
  let tempPath: string;
  let docxPath: string;

  beforeEach(async () => {
    tempPath = await mkdtemp(path.join(tmpdir(), "prd-engine-spec-"));
    docxPath = path.join(tempPath, "Checkout PRD.docx");
    await writeFile(docxPath, await fixtureDocx());
  });

  afterEach(async () => {
    await rm(tempPath, { recursive: true, force: true });
  });

  function options(overrides: Partial<PrdReviewOptions> = {}): PrdReviewOptions {
    return {
      source: { path: docxPath },
      documentType: "prd",
      tempPath,
      runId: "run-1",
      aiProvider: "copilot-sdk",
      aiModel: "test-model",
      chunkOptions: { minChars: 0 },
      output: createCapturingOutputWriter(),
      ...overrides,
    };
  }

  it("reviews every section, verifies findings and writes the reports and run data", async () => {
    const ai = createFakeAIClient(defaultHandler);
    const events: ReviewProgressEvent[] = [];

    const result = await runPrdReview(options({ onProgress: (e) => events.push(e) }), {
      aiClient: ai,
      clock: CLOCK,
    });

    const { report } = result;
    expect(report).toMatchObject({
      schemaVersion: 1,
      kind: "prd",
      runId: "run-1",
      createdAt: "2026-10-23T14:25:30.000Z",
      documentType: "prd",
      source: { fileName: "Checkout PRD.docx" },
      document: {
        title: "Checkout PRD",
        sectionCount: 4,
        chunkCount: 5,
        reviewedChunkCount: 5,
        hasHeadings: true,
        imageCount: 1,
        commentCount: 0,
      },
      readiness: {
        verdict: "not-ready",
        summary: "Scope contradicts itself.",
        modelVerdict: "not-ready",
      },
      complete: true,
      counts: { Blocker: 1, Major: 1, Minor: 1 },
      verification: {
        candidates: 4,
        droppedUnsupportedQuote: 1,
        droppedDuplicate: 0,
        droppedByVerifier: 0,
        kept: 3,
        verifierFailed: false,
      },
      includeImages: false,
      aiProvider: "copilot-sdk",
      aiModel: "test-model",
      tokenUsage: { inputTokens: 70, outputTokens: 70 },
    });
    expect(report.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.findings.map((f) => [f.id, f.severity, f.sectionId, f.dimension])).toEqual([
      ["f1", "Blocker", "s4", "ambiguity"],
      ["f2", "Major", "s2", "ambiguity"],
      ["f3", "Minor", "s2", "general"],
    ]);
    expect(report.findings[1]).toMatchObject({
      dimensionName: "Ambiguity and contradictions",
      headingPath: ["Goals"],
      authorQuestion: "What checkout time are you aiming for?",
      origin: "section",
    });
    expect(report.findings[0]?.origin).toBe("consistency");
    expect(report.notReviewed).toEqual([
      {
        kind: "image",
        description:
          "Image img1 (“Checkout flow diagram”) in “Scope”: images are not reviewed unless image review is turned on.",
        sectionIds: ["s3"],
      },
    ]);

    // Files: Markdown + JSON report, source copy and extracted data.
    const markdown = await readFile(result.paths.reportMarkdown, "utf-8");
    expect(markdown).toBe(result.reportMarkdown);
    expect(markdown.startsWith("# PRD review: Checkout PRD\n")).toBe(true);
    const json = JSON.parse(await readFile(result.paths.reportJson, "utf-8")) as PrdReviewReport;
    expect(json.findings).toHaveLength(3);
    expect(await readFile(result.paths.sourceDocx)).toEqual(await readFile(docxPath));
    const extracted = JSON.parse(await readFile(result.paths.documentJson, "utf-8")) as {
      document: { sections: unknown[] };
      chunks: unknown[];
    };
    expect(extracted.chunks).toHaveLength(5);

    const listed = await listReports({ reportsDir: path.join(tempPath, "reports") });
    expect(listed.map((r) => [r.name, r.kind, r.title])).toEqual([
      ["prd-run-1-review-report.md", "prd", "PRD review: Checkout PRD"],
    ]);

    // Each pass uses its own prompt type; the section prompt wraps the document.
    const types = ai.executePrompt.mock.calls.map(
      (call) => (call[1] as ExecutePromptOptions | undefined)?.promptType
    );
    expect(types.filter((t) => t === "prd-section")).toHaveLength(5);
    expect(types.slice(-2)).toEqual(["prd-consistency", "prd-verify"]);
    expect(String(ai.executePrompt.mock.calls[0]?.[0])).toContain("<untrusted-document>");

    const phases = events
      .filter((e) => e.kind === "phase")
      .map((e) => (e.kind === "phase" ? `${e.id}:${e.status}` : ""));
    expect(phases).toEqual([
      "resolve:start",
      "resolve:done",
      "fetch:start",
      "fetch:done",
      "ai-review:start",
      "ai-review:done",
      "consistency:start",
      "consistency:done",
      "verify:start",
      "verify:done",
      "report:start",
      "report:done",
    ]);
    expect(events.filter((e) => e.kind === "step" && e.status === "done")).toHaveLength(5);

    // A per-run delete removes everything the run wrote.
    await deletePrdRun(result.runId, { tempPath });
    expect(await readdir(path.join(tempPath, "reports"))).toEqual([]);
    expect(await readdir(path.join(tempPath, "prd"))).toEqual([]);
  });

  it("lists failed sections as not reviewed and marks the review partial", async () => {
    const ai = createFakeAIClient((prompt, opts) => {
      if (opts?.promptType === "prd-section" && prompt.includes("Out of scope [s4]")) {
        throw new Error("model timeout");
      }
      if (opts?.promptType === "prd-section" && prompt.includes("Overview [s1]")) {
        return { raw: "Sorry, I cannot help.", parsed: null };
      }
      return defaultHandler(prompt, opts);
    });
    const output = createCapturingOutputWriter();

    const { report, reportMarkdown } = await runPrdReview(options({ output }), {
      aiClient: ai,
      clock: CLOCK,
    });

    expect(report.complete).toBe(false);
    expect(report.document.reviewedChunkCount).toBe(3);
    expect(report.notReviewed.filter((item) => item.kind === "failed-section")).toEqual([
      {
        kind: "failed-section",
        description: "“Overview”: could not be reviewed because the AI request failed.",
        sectionIds: ["s1"],
      },
      {
        kind: "failed-section",
        description: "“Out of scope”: could not be reviewed because the AI request failed.",
        sectionIds: ["s4"],
      },
    ]);
    expect(reportMarkdown).toContain("Partial review");
    expect(output.output.some((o) => o.data.includes("review failed (model timeout)"))).toBe(true);
  });

  it("fails when no section could be reviewed", async () => {
    const ai = createFakeAIClient(() => {
      throw new Error("provider down");
    });
    const events: ReviewProgressEvent[] = [];

    await expect(
      runPrdReview(options({ onProgress: (e) => events.push(e) }), { aiClient: ai })
    ).rejects.toThrow(MergeMentorError);
    await expect(runPrdReview(options(), { aiClient: ai })).rejects.toThrow(
      "None of the 5 part(s) of the document could be reviewed: provider down"
    );
    expect(events).toContainEqual(expect.objectContaining({ id: "ai-review", status: "error" }));
    // The source copy of a failed run is removed again.
    expect(await readdir(path.join(tempPath, "prd"))).toEqual([]);
  });

  it("still produces a report when the whole-document check fails", async () => {
    const ai = createFakeAIClient((prompt, opts) => {
      if (opts?.promptType === "prd-consistency") return { raw: "garbage", parsed: null };
      return defaultHandler(prompt, opts);
    });

    const { report } = await runPrdReview(options(), { aiClient: ai });

    expect(report.complete).toBe(false);
    expect(report.readiness).toEqual({
      verdict: "needs-work",
      summary: "The review found 1 major, 1 minor issues.",
    });
    expect(report.notReviewed.map((item) => item.kind)).toContain("consistency-check");
  });

  it("accepts an in-memory upload, streams with one section at a time, and notes image review is pending", async () => {
    let active = 0;
    let maxActive = 0;
    const ai = createFakeAIClient(async (prompt, opts) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      opts?.onStreamData?.("chunk");
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return defaultHandler(prompt, opts);
    });
    const streamed: string[] = [];
    const events: ReviewProgressEvent[] = [];
    const upload: PrdReviewSource = {
      buffer: await fixtureDocx(),
      fileName: "../uploads/Checkout PRD.docx",
    };

    const { report } = await runPrdReview(
      options({
        source: upload,
        includeImages: true,
        concurrency: 4,
        onStreamChunk: (chunk) => streamed.push(chunk),
        onProgress: (e) => events.push(e),
      }),
      { aiClient: ai, clock: CLOCK }
    );

    expect(maxActive).toBe(1);
    expect(report.source.fileName).toBe("Checkout PRD.docx");
    expect(report.includeImages).toBe(true);
    expect(report.notReviewed[0]?.description).toContain("image review is not available yet");
    expect(streamed.length).toBe(7);
    const streamPhases = new Set(events.flatMap((e) => (e.kind === "stream" ? [e.phase] : [])));
    expect([...streamPhases]).toEqual(["ai-review", "consistency", "verify"]);
  });

  it("reviews sections in parallel when not streaming", async () => {
    let active = 0;
    let maxActive = 0;
    const ai = createFakeAIClient(async (prompt, opts) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return defaultHandler(prompt, opts);
    });

    await runPrdReview(options({ concurrency: 2 }), { aiClient: ai });

    expect(maxActive).toBe(2);
  });

  it("lists parts beyond the chunk limit as not reviewed", async () => {
    const ai = createFakeAIClient(defaultHandler);

    const { report } = await runPrdReview(options({ maxChunks: 3 }), { aiClient: ai });

    expect(report.document).toMatchObject({ chunkCount: 5, reviewedChunkCount: 3 });
    expect(report.complete).toBe(false);
    expect(report.notReviewed.filter((item) => item.kind === "skipped-section")).toEqual([
      {
        kind: "skipped-section",
        description:
          "“Scope”: not reviewed because the document is longer than the review limit of 3 parts.",
        sectionIds: ["s3"],
      },
      {
        kind: "skipped-section",
        description:
          "“Out of scope”: not reviewed because the document is longer than the review limit of 3 parts.",
        sectionIds: ["s4"],
      },
    ]);
  });

  it("labels parts of documents without headings by number and uses the FRD rubric", async () => {
    await writeFile(
      docxPath,
      await buildDocx({
        body: [
          para("REQ-1 The system shall export orders."),
          para("REQ-2 Refunds are allowed."),
        ].join(""),
      })
    );
    const ai = createFakeAIClient((prompt, opts) => {
      if (opts?.promptType === "prd-section") throw new Error("boom");
      return defaultHandler(prompt, opts);
    });

    await expect(runPrdReview(options({ documentType: "frd" }), { aiClient: ai })).rejects.toThrow(
      "None of the 1 part(s)"
    );
    expect(String(ai.executePrompt.mock.calls[0]?.[0])).toContain(
      "Functional Requirements Document"
    );

    const ok = createFakeAIClient((prompt, opts) =>
      opts?.promptType === "prd-section"
        ? jsonResponse({
            summary: "Requirements.",
            keyStatements: [],
            findings: [
              {
                severity: "Major",
                dimension: "acceptance-criteria",
                sectionId: "s0",
                quote: "Refunds are allowed.",
                problem: "No acceptance criteria.",
                suggestion: "Add criteria.",
              },
            ],
          })
        : opts?.promptType === "prd-consistency"
          ? jsonResponse({ readiness: { verdict: "needs-work", summary: "" }, findings: [] })
          : jsonResponse({ verdicts: [] })
    );
    const { report } = await runPrdReview(options({ documentType: "frd" }), { aiClient: ok });
    expect(report.findings[0]).toMatchObject({
      dimensionName: "Acceptance criteria",
      headingPath: [],
    });
    expect(report.readiness.summary).toBe("The review found 1 major issue.");
  });

  it("rejects an empty document, a missing file, an oversized file and an unsafe run id", async () => {
    const ai = createFakeAIClient(defaultHandler);

    await writeFile(docxPath, await buildDocx({ body: "" }));
    await expect(runPrdReview(options(), { aiClient: ai })).rejects.toThrow(
      "the document has no text to review"
    );

    await expect(
      runPrdReview(options({ source: { path: path.join(tempPath, "missing.docx") } }), {
        aiClient: ai,
      })
    ).rejects.toThrow(DocumentParseError);

    await writeFile(docxPath, await fixtureDocx());
    await expect(
      runPrdReview(options({ validation: { maxBytes: 10 } }), { aiClient: ai })
    ).rejects.toThrow(ValidationError);

    await expect(runPrdReview(options({ runId: "../escape" }), { aiClient: ai })).rejects.toThrow(
      ValidationError
    );
    expect(ai.executePrompt).not.toHaveBeenCalled();
    expect(await readdir(tempPath)).toEqual(["Checkout PRD.docx"]);
  });

  it("generates a readable, unique run id when none is given", async () => {
    const ai = createFakeAIClient(defaultHandler);

    const first = await runPrdReview(options({ runId: undefined }), { aiClient: ai, clock: CLOCK });
    const second = await runPrdReview(
      options({ runId: undefined, source: { buffer: await fixtureDocx(), fileName: "" } }),
      { aiClient: ai, clock: CLOCK }
    );

    expect(first.runId).toMatch(/^20261023-142530-checkout-prd-[0-9a-f]{6}$/);
    expect(second.runId).toMatch(/^20261023-142530-document-[0-9a-f]{6}$/);
    expect(second.report.source.fileName).toBe("document.docx");
  });
});
