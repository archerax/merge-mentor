import { beforeAll, describe, expect, it } from "vitest";

import {
  buildDocx,
  heading,
  imageRun,
  para,
  paraXml,
  table,
  TINY_PNG,
} from "./docxFixture.test-helper.js";
import { parseDocx } from "./docxParser.js";
import { createFakeAIClient, jsonResponse } from "./prdAi.test-helper.js";
import {
  checkQuotes,
  dimensionName,
  DocumentTextIndex,
  normaliseForQuoteMatch,
  PrdVerifier,
} from "./prdVerifier.js";
import type { DocxDocument, PrdCandidateFinding } from "./types.js";

let document: DocxDocument;

beforeAll(async () => {
  document = await parseDocx(
    await buildDocx({
      body: [
        heading(1, "Goals"),
        para("Checkout must be “fast” for all users."),
        heading(2, "Metrics"),
        para("Conversion rises by 5% within   two months."),
        heading(1, "Scope"),
        para("Only card payments are in scope."),
        table([
          ["ID", "Requirement"],
          ["R1", "Users can pay by card."],
        ]),
      ].join(""),
    })
  );
});

function paragraphId(text: string): string {
  for (const section of document.sections) {
    if (section.title === text && section.headingParagraphId) return section.headingParagraphId;
    for (const block of section.blocks) {
      if (block.kind === "paragraph" && block.paragraph.text === text) return block.paragraph.id;
      if (block.kind === "table") {
        for (const row of block.table.rows) {
          for (const cell of row.cells) {
            for (const inner of cell.blocks) {
              if (inner.kind === "paragraph" && inner.paragraph.text === text) {
                return inner.paragraph.id;
              }
            }
          }
        }
      }
    }
  }
  throw new Error(`paragraph not found: ${text}`);
}

function candidate(overrides: Partial<PrdCandidateFinding> = {}): PrdCandidateFinding {
  return {
    severity: "Major",
    dimension: "ambiguity",
    sectionId: "s1",
    quote: 'Checkout must be "fast"',
    problem: "Fast is not measurable.",
    suggestion: "State a target time.",
    origin: "section",
    scopeSectionIds: ["s1", "s1.1"],
    ...overrides,
  };
}

describe("normaliseForQuoteMatch", () => {
  it("normalises quotes, dashes, invisible characters, whitespace and case", () => {
    expect(normaliseForQuoteMatch("  “Fast” — it’s  OK​\n ")).toBe('"fast" - it\'s ok');
    expect(normaliseForQuoteMatch("Wait…")).toBe("wait...");
  });
});

describe("DocumentTextIndex", () => {
  it("locates quotes in the given sections, including headings and table cells", () => {
    const index = new DocumentTextIndex(document);
    expect(index.locate("conversion rises by 5% within two months", ["s1.1"])).toEqual({
      sectionId: "s1.1",
      paragraphId: paragraphId("Conversion rises by 5% within   two months."),
    });
    expect(index.locate("Users can pay by card.", null)).toEqual({
      sectionId: "s2",
      paragraphId: paragraphId("Users can pay by card."),
    });
    expect(index.locate("Metrics", ["s1.1"])?.paragraphId).toBe(paragraphId("Metrics"));
    expect(index.locate("Users can pay by card.", ["s1", "missing"])).toBeUndefined();
  });

  it("strips id markers and wrapping quotes, and matches ellipsis segments in order", () => {
    const index = new DocumentTextIndex(document);
    expect(index.locate('"[p2] Checkout must be “fast”"', null)?.sectionId).toBe("s1");
    expect(index.locate("Checkout must ... all users", null)?.sectionId).toBe("s1");
    expect(index.locate("all users ... Checkout must", null)).toBeUndefined();
  });

  it("rejects quotes that are too short to locate anything", () => {
    const index = new DocumentTextIndex(document);
    expect(index.locate("a", null)).toBeUndefined();
    expect(index.locate("...", null)).toBeUndefined();
  });

  it("returns subtrees, heading paths and context around a paragraph", () => {
    const index = new DocumentTextIndex(document);
    expect(index.subtree("s1")).toEqual(["s1", "s1.1"]);
    expect(index.subtree("nope")).toEqual([]);
    expect(index.headingPath("s1.1")).toEqual(["Goals", "Metrics"]);
    expect(index.headingPath("nope")).toEqual([]);

    const context = index.context("s1", paragraphId("Checkout must be “fast” for all users."));
    expect(context).toContain("Section: Goals [s1]");
    expect(context).toContain("Checkout must be “fast” for all users.");
    expect(index.context("nope", undefined)).toBe("");
  });

  it("caps the context length", () => {
    const long: DocxDocument = {
      sections: [
        {
          id: "s0",
          title: "",
          level: 0,
          headingPath: [],
          parentId: null,
          childIds: [],
          headingParagraphId: null,
          blocks: [
            {
              kind: "paragraph",
              paragraph: { id: "p1", text: "word ".repeat(600), commentIds: [], imageIds: [] },
            },
          ],
        },
      ],
      comments: [],
      images: [],
      hasHeadings: false,
      warnings: [],
    };
    const context = new DocumentTextIndex(long).context("s0", "p1");
    expect(context.startsWith("[s0]\n[p1] word")).toBe(true);
    expect(context.length).toBe(1_503);
    expect(context.endsWith("...")).toBe(true);
  });

  it("windows a long context around the quote with truncation marks at both ends", () => {
    const text = `${"alpha ".repeat(500)}The checkout must load within 2 seconds. ${"omega ".repeat(500)}`;
    const long: DocxDocument = {
      sections: [
        {
          id: "s0",
          title: "",
          level: 0,
          headingPath: [],
          parentId: null,
          childIds: [],
          headingParagraphId: null,
          blocks: [
            { kind: "paragraph", paragraph: { id: "p1", text, commentIds: [], imageIds: [] } },
          ],
        },
      ],
      comments: [],
      images: [],
      hasHeadings: false,
      warnings: [],
    };
    const index = new DocumentTextIndex(long);
    const context = index.context("s0", "p1", "the CHECKOUT must load within 2 seconds");
    expect(context.startsWith("[s0]\n...")).toBe(true);
    expect(context.endsWith("...")).toBe(true);
    expect(context).toContain("The checkout must load within 2 seconds.");
    expect(context.length).toBeLessThanOrEqual(1_510);
    // Without a locatable quote the start of the text is kept, as before.
    expect(
      index.context("s0", "p1", "not in the document at all").startsWith("[s0]\n[p1] alpha")
    ).toBe(true);
  });
});

describe("checkQuotes", () => {
  it("keeps supported findings and drops ones whose quote is not in the document", () => {
    const index = new DocumentTextIndex(document);
    const result = checkQuotes(
      index,
      [candidate(), candidate({ quote: "Checkout must be instant" }), candidate({ quote: "  " })],
      "prd"
    );
    expect(result.droppedUnsupportedQuote).toBe(2);
    expect(result.findings).toEqual([
      {
        severity: "Major",
        dimension: "ambiguity",
        dimensionName: "Ambiguity and contradictions",
        sectionId: "s1",
        headingPath: ["Goals"],
        paragraphId: paragraphId("Checkout must be “fast” for all users."),
        quote: 'Checkout must be "fast"',
        problem: "Fast is not measurable.",
        suggestion: "State a target time.",
        origin: "section",
      },
    ]);
  });

  it("re-attributes a finding to the chunk section where the quote is", () => {
    const index = new DocumentTextIndex(document);
    const result = checkQuotes(
      index,
      [candidate({ sectionId: "s1", quote: "within two months", authorQuestion: " By when? " })],
      "prd"
    );
    expect(result.findings[0]).toMatchObject({
      sectionId: "s1.1",
      headingPath: ["Goals", "Metrics"],
      authorQuestion: "By when?",
    });
  });

  it("does not accept a quote from outside the reviewed chunk", () => {
    const index = new DocumentTextIndex(document);
    const result = checkQuotes(index, [candidate({ quote: "Only card payments" })], "prd");
    expect(result.droppedUnsupportedQuote).toBe(1);
  });

  it("searches the whole document for consistency findings", () => {
    const index = new DocumentTextIndex(document);
    const result = checkQuotes(
      index,
      [
        candidate({
          origin: "consistency",
          scopeSectionIds: null,
          sectionId: "s1",
          quote: "Only card payments",
        }),
        candidate({
          origin: "consistency",
          scopeSectionIds: null,
          sectionId: "zz",
          quote: "pay by card",
        }),
      ],
      "prd"
    );
    expect(result.findings.map((f) => f.sectionId)).toEqual(["s2", "s2"]);
  });

  it("collapses exact duplicates, keeping the most severe", () => {
    const index = new DocumentTextIndex(document);
    const result = checkQuotes(
      index,
      [
        candidate({ severity: "Minor" }),
        candidate({ severity: "Blocker", quote: "checkout  must be “fast”" }),
        candidate({ severity: "Minor" }),
        candidate({ dimension: "scope" }),
      ],
      "prd"
    );
    expect(result.droppedDuplicate).toBe(2);
    expect(result.findings.map((f) => [f.severity, f.dimension])).toEqual([
      ["Blocker", "ambiguity"],
      ["Major", "scope"],
    ]);
  });
});

function imageCandidate(overrides: Partial<PrdCandidateFinding>): PrdCandidateFinding {
  return candidate({
    origin: "image",
    imageId: "img1",
    sectionId: "s1",
    scopeSectionIds: ["s1", "s2"],
    quote: "",
    ...overrides,
  });
}

describe("checkQuotes for image findings", () => {
  it("keeps the most severe of duplicate image findings, whichever comes first", async () => {
    const withImage = await parseDocx(
      await buildDocx({
        body: [heading(1, "Flow"), paraXml(imageRun("rIdImg1", "Payment flow"))].join(""),
        images: [{ relId: "rIdImg1", fileName: "image1.png", data: TINY_PNG }],
      })
    );
    const index = new DocumentTextIndex(withImage);

    const result = checkQuotes(
      index,
      [
        imageCandidate({ severity: "Minor", problem: "No legend." }),
        imageCandidate({ severity: "Blocker", problem: "No legend." }),
        imageCandidate({ severity: "Major", problem: "No legend." }),
      ],
      "prd"
    );

    expect(result.droppedDuplicate).toBe(2);
    expect(result.findings.map((f) => f.severity)).toEqual(["Blocker"]);
  });

  it("grounds image findings by image id and section, clearing quotes it cannot find", async () => {
    const withImage = await parseDocx(
      await buildDocx({
        body: [
          heading(1, "Intro"),
          para("Nothing here."),
          heading(1, "Flow"),
          para("The shopper pays."),
          paraXml(imageRun("rIdImg1", "Payment flow")),
        ].join(""),
        images: [{ relId: "rIdImg1", fileName: "image1.png", data: TINY_PNG }],
      })
    );
    const index = new DocumentTextIndex(withImage);
    const image = withImage.images[0];

    const result = checkQuotes(
      index,
      [
        imageCandidate({ quote: "The shopper pays.", problem: "Shows a refund step." }),
        imageCandidate({ quote: "“Payment flow”", problem: "No legend." }),
        imageCandidate({ quote: "Nothing here.", problem: "Wrong section quote." }),
        imageCandidate({ problem: "No legend." }),
        imageCandidate({ imageId: "img7", problem: "Unknown image." }),
      ],
      "prd"
    );

    expect(result.droppedUnsupportedQuote).toBe(1);
    expect(result.droppedDuplicate).toBe(1);
    expect(result.findings.map((f) => [f.sectionId, f.quote, f.imageId, f.paragraphId])).toEqual([
      ["s2", "The shopper pays.", "img1", paragraphIdIn(withImage, "The shopper pays.")],
      ["s2", "Payment flow", "img1", image?.paragraphId],
      ["s2", "", "img1", image?.paragraphId],
    ]);
    expect(result.findings[0]).toMatchObject({
      headingPath: ["Flow"],
      imageAltText: "Payment flow",
      origin: "image",
    });
  });
});

function paragraphIdIn(doc: DocxDocument, text: string): string | undefined {
  for (const section of doc.sections) {
    for (const block of section.blocks) {
      if (block.kind === "paragraph" && block.paragraph.text === text) return block.paragraph.id;
    }
  }
  return undefined;
}

describe("dimensionName", () => {
  it("looks up rubric names and falls back to General", () => {
    expect(dimensionName("frd", "edge-cases")).toBe("Edge cases and error handling");
    expect(dimensionName("frd", "scope")).toBe("General");
  });
});

describe("PrdVerifier", () => {
  it("drops findings the AI verifier rejects and records the counts", async () => {
    const ai = createFakeAIClient(() =>
      jsonResponse({
        verdicts: [
          { id: "F1", keep: true, reason: "Supported." },
          { id: " F2 ", keep: false, reason: "The next sentence answers it." },
        ],
      })
    );
    const usage: unknown[] = [];
    const verifier = new PrdVerifier(ai, {
      documentType: "prd",
      onTokenUsage: (u) => usage.push(u),
      transcriptDir: "/runs/run-1/transcripts",
    });

    const result = await verifier.verify(document, [
      candidate(),
      candidate({ quote: "within two months", sectionId: "s1.1" }),
      candidate({ quote: "not in the document" }),
    ]);

    expect(result.findings.map((f) => f.quote)).toEqual(['Checkout must be "fast"']);
    expect(result.stats).toEqual({
      candidates: 3,
      droppedUnsupportedQuote: 1,
      droppedDuplicate: 0,
      droppedByVerifier: 1,
      kept: 1,
      verifierFailed: false,
    });
    expect(usage).toHaveLength(1);
    const [prompt, options] = ai.executePrompt.mock.calls[0] as [
      string,
      { promptType: string; transcriptDir?: string },
    ];
    expect(options.promptType).toBe("prd-verify");
    expect(options.transcriptDir).toBe("/runs/run-1/transcripts");
    expect(prompt).toContain("## F2");
    expect(prompt).toContain("Section: Goals > Metrics [s1.1]");
  });

  it("batches candidates and keeps a batch unchecked when its call fails", async () => {
    let call = 0;
    const ai = createFakeAIClient(() => {
      call += 1;
      if (call === 1) throw new Error("timeout");
      return jsonResponse({ verdicts: [{ id: "F2", keep: false, reason: "no" }] });
    });
    const verifier = new PrdVerifier(ai, { documentType: "prd", batchSize: 1 });

    const result = await verifier.verify(document, [
      candidate(),
      candidate({ quote: "within two months", sectionId: "s1.1" }),
    ]);

    expect(ai.executePrompt).toHaveBeenCalledTimes(2);
    expect(result.findings.map((f) => f.quote)).toEqual(['Checkout must be "fast"']);
    expect(result.stats.verifierFailed).toBe(true);
    expect(result.stats.droppedByVerifier).toBe(1);
  });

  it("falls back to the default batch size when batchSize is not a usable number", async () => {
    for (const batchSize of [Number.NaN, 0, -3, Number.POSITIVE_INFINITY]) {
      const ai = createFakeAIClient(() =>
        jsonResponse({ verdicts: [{ id: "F1", keep: true, reason: "ok" }] })
      );
      const result = await new PrdVerifier(ai, { documentType: "prd", batchSize }).verify(
        document,
        [candidate()]
      );
      expect(ai.executePrompt).toHaveBeenCalledTimes(1);
      expect(result.findings).toHaveLength(1);
    }
  });

  it("keeps findings unchecked when the verifier response is unusable", async () => {
    const ai = createFakeAIClient(() => ({ raw: "no json here", parsed: null }));
    const result = await new PrdVerifier(ai, { documentType: "prd" }).verify(document, [
      candidate(),
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.stats.verifierFailed).toBe(true);

    const malformed = createFakeAIClient(() => jsonResponse({ verdicts: "nope" }));
    const second = await new PrdVerifier(malformed, { documentType: "prd" }).verify(document, [
      candidate(),
    ]);
    expect(second.stats.verifierFailed).toBe(true);
  });

  it.each([
    ["a verdict is missing", [{ id: "F1", keep: false, reason: "no" }]],
    [
      "an unknown id is present",
      [
        { id: "F1", keep: true, reason: "ok" },
        { id: "F9", keep: false, reason: "who?" },
      ],
    ],
    [
      "a candidate is judged twice",
      [
        { id: "F1", keep: true, reason: "ok" },
        { id: "F1", keep: false, reason: "again" },
      ],
    ],
    ["there are no verdicts", []],
  ])("treats the response as unusable when %s", async (_name, verdicts) => {
    const ai = createFakeAIClient(() => jsonResponse({ verdicts }));
    const result = await new PrdVerifier(ai, { documentType: "prd" }).verify(document, [
      candidate(),
      candidate({ quote: "within two months", sectionId: "s1.1" }),
    ]);

    expect(result.findings).toHaveLength(2);
    expect(result.stats).toMatchObject({ verifierFailed: true, droppedByVerifier: 0, kept: 2 });
  });

  it("treats a malformed keep value as an unusable batch, not a positive verdict", async () => {
    const ai = createFakeAIClient(() =>
      jsonResponse({
        verdicts: [
          { id: "F1", keep: "false", reason: "no" },
          { id: "F2", keep: true, reason: "ok" },
        ],
      })
    );
    const result = await new PrdVerifier(ai, { documentType: "prd" }).verify(document, [
      candidate(),
      candidate({ quote: "within two months", sectionId: "s1.1" }),
    ]);

    expect(result.findings).toHaveLength(2);
    expect(result.stats).toMatchObject({ verifierFailed: true, droppedByVerifier: 0, kept: 2 });
  });

  it("reads JSON from the raw text when the provider did not parse it, and streams", async () => {
    const ai = createFakeAIClient(() => ({
      raw: '```json\n{"verdicts":[{"id":"F1","keep":false,"reason":"misread"}]}\n```',
      parsed: null,
    }));
    const chunks: string[] = [];
    const result = await new PrdVerifier(ai, {
      documentType: "prd",
      onStreamData: (chunk) => chunks.push(chunk),
    }).verify(document, [candidate()]);
    expect(result.findings).toEqual([]);
    expect(ai.executePrompt.mock.calls[0]?.[1]).toMatchObject({
      onStreamData: expect.any(Function),
    });
  });

  it("skips the AI pass when disabled or when nothing survives the quote check", async () => {
    const ai = createFakeAIClient(() => jsonResponse({ verdicts: [] }));
    const disabled = await new PrdVerifier(ai, {
      documentType: "prd",
      aiVerification: false,
    }).verify(document, [candidate()]);
    expect(disabled.findings).toHaveLength(1);

    const empty = await new PrdVerifier(ai, { documentType: "prd" }).verify(document, [
      candidate({ quote: "nothing like this" }),
    ]);
    expect(empty.findings).toEqual([]);
    expect(ai.executePrompt).not.toHaveBeenCalled();
  });
  it("only matches an image quote in the image's paragraph and its near neighbours", async () => {
    const doc = await parseDocx(
      await buildDocx({
        body: [
          heading(1, "Flow"),
          para("Far before the picture."),
          para("Filler one."),
          para("Filler two."),
          para("Just before the picture."),
          paraXml(imageRun("rIdImg1", "Payment flow")),
          para("Right after the picture."),
          para("Filler three."),
          para("Filler four."),
          para("Far after the picture."),
          heading(2, "Details"),
          para("Text in a subsection."),
        ].join(""),
        images: [{ relId: "rIdImg1", fileName: "image1.png", data: TINY_PNG }],
      })
    );
    const quotes = [
      "Just before the picture.",
      "Right after the picture.",
      "Far before the picture.",
      "Far after the picture.",
      "Text in a subsection.",
    ];

    const result = checkQuotes(
      new DocumentTextIndex(doc),
      quotes.map((quote) => imageCandidate({ sectionId: "s1", quote, problem: quote })),
      "prd"
    );

    // Distant and subsection quotes are cleared, but the image findings are kept.
    expect(result.droppedUnsupportedQuote).toBe(0);
    expect(result.findings.map((f) => [f.quote, f.sectionId])).toEqual([
      ["Just before the picture.", "s1"],
      ["Right after the picture.", "s1"],
      ["", "s1"],
      ["", "s1"],
      ["", "s1"],
    ]);
  });
});
