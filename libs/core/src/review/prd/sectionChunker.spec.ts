import { ValidationError } from "@merge-mentor/shared/errors/index.js";
import { describe, expect, it } from "vitest";

import {
  buildDocx,
  commentEnd,
  commentStart,
  heading,
  imageRun,
  para,
  paraXml,
  run,
  table,
  TINY_PNG,
} from "./docxFixture.test-helper.js";
import { parseDocx } from "./docxParser.js";
import { chunkDocument, DEFAULT_CHUNK_OPTIONS } from "./sectionChunker.js";
import type { DocxBlock, DocxDocument, DocxParagraph, DocxSection } from "./types.js";

let paragraphCounter = 0;

function p(text: string, extra: Partial<DocxParagraph> = {}): DocxBlock {
  paragraphCounter += 1;
  return {
    kind: "paragraph",
    paragraph: { id: `p${paragraphCounter}`, text, commentIds: [], imageIds: [], ...extra },
  };
}

function s(
  id: string,
  title: string,
  blocks: DocxBlock[],
  options: { parentId?: string | null; childIds?: string[]; level?: number; path?: string[] } = {}
): DocxSection {
  const level = options.level ?? id.split(".").length;
  return {
    id,
    title,
    level,
    headingPath: options.path ?? [title],
    parentId: options.parentId ?? null,
    childIds: options.childIds ?? [],
    headingParagraphId: level === 0 ? null : `h-${id}`,
    blocks,
  };
}

function doc(sections: DocxSection[], extra: Partial<DocxDocument> = {}): DocxDocument {
  return {
    sections,
    comments: [],
    images: [],
    hasHeadings: sections.some((section) => section.level > 0),
    warnings: [],
    ...extra,
  };
}

const words = (count: number, word = "word") => Array.from({ length: count }, () => word).join(" ");

describe("chunkDocument", () => {
  it("exposes the defaults settled in the spike", () => {
    expect(DEFAULT_CHUNK_OPTIONS).toEqual({
      maxChars: 24_000,
      minChars: 4_000,
      fallbackChunkChars: 12_000,
      overlapChars: 1_500,
    });
  });

  it("renders paragraphs with ids under a heading path header", () => {
    const document = doc([
      s("s1", "Overview", [p("Problem statement.")], { childIds: ["s1.1"] }),
      s("s1.1", "Goals", [p("Grow revenue.")], { parentId: "s1", path: ["Overview", "Goals"] }),
    ]);

    const chunks = chunkDocument(document);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      id: "c1",
      sectionIds: ["s1", "s1.1"],
      headingPath: ["Overview"],
    });
    expect(chunks[0]?.text).toBe(
      [
        "# Overview [s1]",
        "[p1] Problem statement.",
        "## Overview > Goals [s1.1]",
        "[p2] Grow revenue.",
      ].join("\n\n")
    );
    expect(chunks[0]?.paragraphIds).toEqual(["h-s1", "p1", "h-s1.1", "p2"]);
  });

  it("keeps a subtree together when it fits and splits into subsections when it does not", () => {
    const big = words(300);
    const document = doc([
      s("s1", "Small", [p("tiny")]),
      s("s2", "Large", [p("intro")], { childIds: ["s2.1", "s2.2"] }),
      s("s2.1", "A", [p(big)], { parentId: "s2", path: ["Large", "A"] }),
      s("s2.2", "B", [p(big)], { parentId: "s2", path: ["Large", "B"] }),
    ]);

    const chunks = chunkDocument(document, { maxChars: 2_500, minChars: 0, overlapChars: 100 });

    expect(chunks.map((c) => c.sectionIds)).toEqual([["s1"], ["s2"], ["s2.1"], ["s2.2"]]);
    expect(chunks.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(chunks[2]?.headingPath).toEqual(["Large", "A"]);
    expect(chunks.every((c) => c.text.length <= 2_500)).toBe(true);
  });

  it("skips the own-content chunk of a heading that only has subsections", () => {
    const big = words(300);
    const document = doc([
      s("s1", "Parent", [], { childIds: ["s1.1", "s1.2"] }),
      s("s1.1", "A", [p(big)], { parentId: "s1", path: ["Parent", "A"] }),
      s("s1.2", "B", [p(big)], { parentId: "s1", path: ["Parent", "B"] }),
    ]);

    const chunks = chunkDocument(document, { maxChars: 2_500, minChars: 0, overlapChars: 100 });

    expect(chunks.map((c) => c.sectionIds)).toEqual([["s1.1"], ["s1.2"]]);
  });

  it("merges small neighbouring chunks up to the size limit", () => {
    const medium = words(250);
    const document = doc([
      s("s1", "One", [p("a")]),
      s("s2", "Two", [p("b")]),
      s("s3", "Three", [p(medium)]),
      s("s4", "Four", [p(medium)]),
    ]);

    const chunks = chunkDocument(document, { maxChars: 2_000, minChars: 500, overlapChars: 100 });

    expect(chunks.map((c) => c.sectionIds)).toEqual([["s1", "s2", "s3"], ["s4"]]);
    expect(chunks[0]?.headingPath).toEqual(["One"]);
  });

  it("splits an oversized section at block boundaries with overlap and part numbers", () => {
    const blocks = Array.from({ length: 12 }, (_, i) => p(`Requirement ${i + 1}: ${words(40)}`));
    const document = doc([s("s1", "Requirements", blocks)]);

    const chunks = chunkDocument(document, { maxChars: 1_200, minChars: 0, overlapChars: 300 });

    expect(chunks.length).toBeGreaterThan(2);
    chunks.forEach((chunk, index) => {
      expect(chunk.part).toEqual({ index: index + 1, total: chunks.length });
      expect(chunk.sectionIds).toEqual(["s1"]);
      expect(chunk.text.length).toBeLessThanOrEqual(1_200);
      expect(
        chunk.text.startsWith(`# Requirements [s1] (part ${index + 1} of ${chunks.length})`)
      ).toBe(true);
    });
    // Consecutive parts share at least one paragraph (overlap) and together cover all.
    for (let i = 1; i < chunks.length; i++) {
      const previous = new Set(chunks[i - 1]?.paragraphIds);
      expect(chunks[i]?.paragraphIds.some((id) => previous.has(id))).toBe(true);
    }
    const covered = new Set(chunks.flatMap((c) => c.paragraphIds));
    const blockIds = blocks.flatMap((block) =>
      block.kind === "paragraph" ? [block.paragraph.id] : []
    );
    expect(blockIds.filter((id) => !covered.has(id))).toEqual([]);
    // Split parts are never merged back together.
    expect(chunks.every((c) => c.part !== undefined)).toBe(true);
  });

  it("gives each slice of an oversized table only the paragraphs in its own text", () => {
    const rows = Array.from({ length: 16 }, (_, i) => `row${i} ${words(10)}`);
    const matrix = {
      kind: "table" as const,
      table: {
        id: "t1",
        rows: rows.map((text, i) => ({
          isHeader: false,
          cells: [
            {
              colSpan: 1,
              rowSpan: 1,
              blocks: [
                {
                  kind: "paragraph" as const,
                  paragraph: { id: `tp${i}`, text, commentIds: [], imageIds: [] },
                },
              ],
            },
          ],
        })),
      },
    };
    const document = doc([s("s1", "Matrix", [matrix])]);

    const chunks = chunkDocument(document, { maxChars: 400, minChars: 0, overlapChars: 40 });

    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.paragraphIds.length).toBeGreaterThan(0);
      // Only the first id may be a paragraph continued from the previous slice.
      for (const id of chunk.paragraphIds.slice(1)) expect(chunk.text).toContain(`[${id}]`);
    }
    // The last row is only in the last slice, not in the first.
    expect(chunks[0]?.paragraphIds).not.toContain("tp15");
    expect(chunks.at(-1)?.paragraphIds).toContain("tp15");
    const covered = new Set(chunks.flatMap((chunk) => chunk.paragraphIds));
    expect(rows.filter((_, i) => !covered.has(`tp${i}`))).toEqual([]);
  });

  it("keeps a positive body budget when the heading path is longer than maxChars", () => {
    const longPath = Array.from({ length: 6 }, (_, i) => `${i}${"h".repeat(150)}`);
    const body = Array.from({ length: 12 }, (_, i) => p(`Sentence ${i} ${words(15)}.`));
    const document = doc([s("s1", longPath.at(-1) ?? "", body, { path: longPath, level: 6 })]);

    const chunks = chunkDocument(document, { maxChars: 300, minChars: 0, overlapChars: 20 });

    // Not one chunk per character, and every paragraph is still reviewed.
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(40);
    const covered = new Set(chunks.flatMap((chunk) => chunk.paragraphIds));
    const bodyIds = body.flatMap((block) =>
      block.kind === "paragraph" ? [block.paragraph.id] : []
    );
    expect(bodyIds.filter((id) => !covered.has(id))).toEqual([]);
    for (const chunk of chunks) {
      const [header, ...rest] = chunk.text.split("\n\n");
      expect(header?.length).toBeLessThan(300);
      expect(rest.join("").trim().length).toBeGreaterThan(0);
    }
    expect(chunks[0]?.text).toContain("…");
  });

  it("keeps a heading-only section with a very long heading path", () => {
    const longPath = ["a".repeat(500)];
    const document = doc([s("s1", longPath[0] ?? "", [], { path: longPath, level: 1 })]);

    const chunks = chunkDocument(document, { maxChars: 100, minChars: 0, overlapChars: 10 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.paragraphIds).toEqual(["h-s1"]);
    expect(chunks[0]?.text).toContain("[s1]");
  });

  it("splits a single oversized paragraph at whitespace", () => {
    const text = Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ");
    const document = doc([s("s0", "", [p(text)], { level: 0, path: [] })], { hasHeadings: false });

    const chunks = chunkDocument(document, { fallbackChunkChars: 500, overlapChars: 50 });

    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(500);
      expect(chunk.text).not.toMatch(/^\S*w\d+\S*$/); // not a single word
    }
    // No word is cut in half, and every word appears somewhere.
    const seen = new Set(chunks.flatMap((c) => c.text.split(/\s+/)));
    for (let i = 0; i < 400; i++) expect(seen.has(`w${i}`)).toBe(true);
    // Overlap: the end of one chunk reappears at the start of the next.
    const lastWord = chunks[0]?.text.split(" ").at(-1) ?? "";
    expect(chunks[1]?.text).toContain(lastWord);
  });

  describe("documents without headings", () => {
    it("uses fixed-size chunks with block-level overlap", () => {
      const blocks = Array.from({ length: 30 }, (_, i) => p(`Paragraph ${i + 1}. ${words(20)}`));
      const document = doc([s("s0", "", blocks, { level: 0, path: [] })]);

      const chunks = chunkDocument(document, { fallbackChunkChars: 1_000, overlapChars: 250 });

      expect(document.hasHeadings).toBe(false);
      expect(chunks.length).toBeGreaterThan(3);
      for (const chunk of chunks) {
        expect(chunk.sectionIds).toEqual(["s0"]);
        expect(chunk.headingPath).toEqual([]);
        expect(chunk.part).toBeUndefined();
        expect(chunk.text.length).toBeLessThanOrEqual(1_000);
        expect(chunk.text.startsWith("[p")).toBe(true);
      }
      for (let i = 1; i < chunks.length; i++) {
        const previous = chunks[i - 1]?.paragraphIds ?? [];
        const current = chunks[i]?.paragraphIds ?? [];
        expect(current[0]).toBe(previous.at(-2)); // two ~140-char paragraphs fit in 250
      }
    });

    it("returns no chunks for an empty document", () => {
      expect(chunkDocument(doc([s("s0", "", [], { level: 0, path: [] })]))).toEqual([]);
    });
  });

  it("renders tables, list items, comments and images", () => {
    const document = doc(
      [
        s("s1", "Reqs", [
          p("Item", { list: { level: 1, ordered: false } }),
          p("Step", { list: { level: 0, ordered: true } }),
          p("Has comment", { commentIds: ["c9", "missing"] }),
          p("", { imageIds: ["img1", "img2"] }),
          {
            kind: "table",
            table: {
              id: "t1",
              rows: [
                {
                  isHeader: true,
                  cells: [
                    { blocks: [p("ID")], colSpan: 1, rowSpan: 1 },
                    { blocks: [p("A | B"), p("line\nbreak")], colSpan: 1, rowSpan: 1 },
                  ],
                },
                {
                  isHeader: false,
                  cells: [
                    {
                      blocks: [
                        p("FR-1", { commentIds: ["c9"], imageIds: ["img1"] }),
                        {
                          kind: "table",
                          table: {
                            id: "t2",
                            rows: [
                              {
                                isHeader: false,
                                cells: [
                                  { blocks: [p("x")], colSpan: 1, rowSpan: 1 },
                                  { blocks: [p("y")], colSpan: 1, rowSpan: 1 },
                                ],
                              },
                            ],
                          },
                        },
                      ],
                      colSpan: 2,
                      rowSpan: 1,
                    },
                  ],
                },
              ],
            },
          },
        ]),
      ],
      {
        comments: [
          {
            id: "c9",
            author: "Jane",
            text: "Clarify.",
            anchorText: "Has\ncomment",
            paragraphId: "p3",
            sectionId: "s1",
          },
        ],
        images: [
          {
            id: "img1",
            paragraphId: "p4",
            sectionId: "s1",
            contentType: "image/png",
            altText: "Flow",
          },
          { id: "img2", paragraphId: "p4", sectionId: "s1", contentType: "image/png" },
        ],
      }
    );

    const [chunk] = chunkDocument(document);

    const lines = chunk?.text.split("\n") ?? [];
    expect(lines).toContain(`[${idOf(document, 0)}]   - Item`);
    expect(lines).toContain(`[${idOf(document, 1)}] 1. Step`);
    expect(lines).toContain('  [existing comment c9 by Jane on "Has comment"]: Clarify.');
    expect(lines).toContain("  [image img1: Flow]");
    expect(lines).toContain("  [image img2]");
    expect(lines).toContain("[t1] Table:");
    expect(chunk?.text).toMatch(/\| \[p\d+\] ID \| \[p\d+\] A \\\| B \[p\d+\] line break \|/);
    expect(chunk?.text).toMatch(/\| \[p\d+\] FR-1 \[p\d+\] x; \[p\d+\] y \|/);
    // Paragraphs inside tables are tracked for the chunk.
    expect(chunk?.paragraphIds.length).toBe(1 + 4 + 6);
  });

  it("rejects inconsistent options", () => {
    const document = doc([s("s1", "A", [p("x")])]);
    expect(() => chunkDocument(document, { maxChars: 0 })).toThrow(ValidationError);
    expect(() => chunkDocument(document, { fallbackChunkChars: Number.NaN })).toThrow(
      /positive numbers/
    );
    expect(() => chunkDocument(document, { overlapChars: -1 })).toThrow(/finite and not negative/);
    expect(() => chunkDocument(document, { overlapChars: Number.NaN })).toThrow(
      /finite and not negative/
    );
    expect(() => chunkDocument(document, { minChars: Number.POSITIVE_INFINITY })).toThrow(
      /finite and not negative/
    );
    expect(() => chunkDocument(document, { maxChars: 1_000, overlapChars: 600 })).toThrow(
      /at most half/
    );
  });

  it("chunks a parsed .docx end to end", async () => {
    const buffer = await buildDocx({
      body:
        heading(1, "Login") +
        paraXml(run("Users ") + commentStart(0) + run("log in fast") + commentEnd(0)) +
        table([
          ["ID", "Requirement"],
          ["FR-1", "SSO login"],
        ]) +
        paraXml(imageRun("rIdImg1", "Login screen")) +
        heading(1, "Errors") +
        para("Show a friendly error."),
      comments: [{ id: 0, author: "Jane Doe", text: "Define fast." }],
      images: [{ relId: "rIdImg1", fileName: "image1.png", data: TINY_PNG }],
    });

    const chunks = chunkDocument(await parseDocx(buffer));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.sectionIds).toEqual(["s1", "s2"]);
    expect(chunks[0]?.text).toBe(
      [
        "# Login [s1]",
        '[p2] Users log in fast\n  [existing comment 0 by Jane Doe on "log in fast"]: Define fast.',
        "[t1] Table:\n| [p3] ID | [p4] Requirement |\n| [p5] FR-1 | [p6] SSO login |",
        "[p7]\n  [image img1: Login screen]",
        "# Errors [s2]",
        "[p9] Show a friendly error.",
      ].join("\n\n")
    );
  });

  describe("a parent heading whose subtree exceeds maxChars", () => {
    const options = { maxChars: 1_000, minChars: 0, overlapChars: 100, fallbackChunkChars: 1_000 };

    it("keeps the parent heading and its own paragraph in a chunk", () => {
      const own = p("Parent own paragraph.");
      const document = doc([
        s("s1", "Parent", [own], { childIds: ["s1.1", "s1.2"] }),
        s("s1.1", "A", [p(words(120))], { parentId: "s1", path: ["Parent", "A"] }),
        s("s1.2", "B", [p(words(120))], { parentId: "s1", path: ["Parent", "B"] }),
      ]);
      const chunks = chunkDocument(document, options);
      const ownId = own.kind === "paragraph" ? own.paragraph.id : "";
      const covered = new Set(chunks.flatMap((chunk) => chunk.paragraphIds));
      expect(covered.has("h-s1")).toBe(true);
      expect(covered.has(ownId)).toBe(true);
    });

    it("keeps the parent heading paragraph when its own blocks need several parts", () => {
      const document = doc([
        s("s1", "Parent", [p(words(150)), p(words(150)), p(words(150))], { childIds: ["s1.1"] }),
        s("s1.1", "A", [p("Child.")], { parentId: "s1", path: ["Parent", "A"] }),
      ]);
      const chunks = chunkDocument(document, options);
      expect(chunks.filter((chunk) => chunk.sectionIds.includes("s1")).length).toBeGreaterThan(1);
      const parentChunks = chunks.filter((chunk) => chunk.sectionIds.includes("s1"));
      expect(parentChunks.some((chunk) => chunk.paragraphIds.includes("h-s1"))).toBe(true);
    });
  });
});

function idOf(document: DocxDocument, index: number): string {
  const block = document.sections[0]?.blocks[index];
  return block?.kind === "paragraph" ? block.paragraph.id : "";
}
