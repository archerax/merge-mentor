import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DocumentParseError, ValidationError } from "@merge-mentor/shared/errors/index.js";
import { createStubFileSystem } from "@merge-mentor/shared/ports/fileSystem.test-helper.js";
import { nodeFs } from "@merge-mentor/shared/ports/index.js";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDocx,
  commentEnd,
  commentStart,
  del,
  heading,
  imageRun,
  ins,
  listItem,
  para,
  paraXml,
  run,
  table,
  TINY_PNG,
} from "./docxFixture.test-helper.js";
import { parseDocx, parseDocxFile } from "./docxParser.js";
import type { DocxBlock, DocxDocument, DocxParagraph, DocxSection, DocxTable } from "./types.js";

function section(doc: DocxDocument, id: string): DocxSection {
  const found = doc.sections.find((s) => s.id === id);
  if (!found) throw new Error(`section ${id} not found`);
  return found;
}

function paragraphs(blocks: readonly DocxBlock[]): DocxParagraph[] {
  return blocks.flatMap((block) =>
    block.kind === "paragraph"
      ? [block.paragraph]
      : block.table.rows.flatMap((row) => row.cells.flatMap((cell) => paragraphs(cell.blocks)))
  );
}

function allParagraphs(doc: DocxDocument): DocxParagraph[] {
  return doc.sections.flatMap((s) => paragraphs(s.blocks));
}

function firstTable(blocks: readonly DocxBlock[]): DocxTable {
  const block = blocks.find((b) => b.kind === "table");
  if (block?.kind !== "table") throw new Error("no table");
  return block.table;
}

function cellTexts(docxTable: DocxTable): string[][] {
  return docxTable.rows.map((row) =>
    row.cells.map((cell) =>
      paragraphs(cell.blocks)
        .map((p) => p.text)
        .join(" ")
    )
  );
}

describe("parseDocx", () => {
  describe("heading hierarchy", () => {
    it("builds a section tree with stable hierarchical ids", async () => {
      const buffer = await buildDocx({
        body:
          paraXml(run("Checkout Revamp PRD"), "Title") +
          para("Owner: Product team") +
          heading(1, "Overview") +
          para("We are rebuilding checkout.") +
          heading(2, "Goals") +
          para("Reduce drop-off by 10%.") +
          heading(3, "Metrics") +
          para("Conversion rate.") +
          heading(2, "Non-goals") +
          para("Mobile app.") +
          heading(1, "Requirements") +
          heading(3, "Skipped level") +
          para("Deep content."),
      });

      const doc = await parseDocx(buffer);

      expect(doc.title).toBe("Checkout Revamp PRD");
      expect(doc.hasHeadings).toBe(true);
      expect(doc.sections.map((s) => [s.id, s.title, s.level, s.parentId])).toEqual([
        ["s0", "", 0, null],
        ["s1", "Overview", 1, null],
        ["s1.1", "Goals", 2, "s1"],
        ["s1.1.1", "Metrics", 3, "s1.1"],
        ["s1.2", "Non-goals", 2, "s1"],
        ["s2", "Requirements", 1, null],
        ["s2.1", "Skipped level", 3, "s2"],
      ]);
      expect(section(doc, "s1").childIds).toEqual(["s1.1", "s1.2"]);
      expect(section(doc, "s1.1.1").headingPath).toEqual(["Overview", "Goals", "Metrics"]);
      expect(paragraphs(section(doc, "s0").blocks).map((p) => p.text)).toEqual([
        "Checkout Revamp PRD",
        "Owner: Product team",
      ]);
      expect(paragraphs(section(doc, "s1.1").blocks).map((p) => p.text)).toEqual([
        "Reduce drop-off by 10%.",
      ]);
    });

    it("assigns sequential paragraph ids including headings, deterministic across runs", async () => {
      const buffer = await buildDocx({
        body: heading(1, "A") + para("one") + heading(2, "B") + para("two"),
      });

      const first = await parseDocx(buffer);
      const second = await parseDocx(buffer);

      expect(section(first, "s1").headingParagraphId).toBe("p1");
      expect(allParagraphs(first).map((p) => p.id)).toEqual(["p2", "p4"]);
      expect(section(first, "s1.1").headingParagraphId).toBe("p3");
      expect(second).toEqual(first);
    });

    it("recognises headings by style id when styles.xml is missing", async () => {
      const buffer = await buildDocx({
        body: heading(1, "Intro") + para("Body"),
        includeStyles: false,
      });

      const doc = await parseDocx(buffer);

      expect(doc.hasHeadings).toBe(true);
      expect(doc.sections.map((s) => s.title)).toEqual(["Intro"]);
    });

    it("treats empty headings as ordinary (dropped) paragraphs", async () => {
      const buffer = await buildDocx({ body: heading(1, "   ") + para("Body") });

      const doc = await parseDocx(buffer);

      expect(doc.hasHeadings).toBe(false);
      expect(doc.sections).toHaveLength(1);
      expect(allParagraphs(doc).map((p) => p.text)).toEqual(["Body"]);
    });
  });

  it("drops empty paragraphs and normalises whitespace", async () => {
    const buffer = await buildDocx({
      body:
        para("") +
        para("   ") +
        paraXml(run("Line one  ") + "<w:r><w:br/></w:r>" + run("Line two   ")) +
        paraXml(run("a") + "<w:r><w:tab/></w:r>" + run("b")) +
        paraXml(run("page") + '<w:r><w:br w:type="page"/></w:r>' + run("break")),
    });

    const doc = await parseDocx(buffer);

    expect(allParagraphs(doc).map((p) => p.text)).toEqual([
      "Line one\nLine two",
      "a\tb",
      "pagebreak",
    ]);
  });

  it("records list membership", async () => {
    const buffer = await buildDocx({
      body: listItem("Bullet", 1) + listItem("Nested", 1, 1) + listItem("Step one", 2),
    });

    const doc = await parseDocx(buffer);
    const [bullet, nested, step] = allParagraphs(doc);

    expect(bullet).toMatchObject({
      list: { level: 0, ordered: false },
      styleName: "List Paragraph",
    });
    expect(nested?.list).toEqual({ level: 1, ordered: false });
    expect(step?.list).toEqual({ level: 0, ordered: true });
  });

  it("parses an FRD requirement matrix table", async () => {
    const buffer = await buildDocx({
      body:
        heading(1, "Functional requirements") +
        para("The system shall support the following:") +
        table([
          ["ID", "Requirement", "Acceptance criteria", "Priority"],
          ["FR-1", "Users can log in with SSO", "Login completes in < 2s", "Must"],
          ["FR-2", "Users can reset their password", "Reset email sent | logged", "Should"],
        ]) +
        para("After the table."),
    });

    const doc = await parseDocx(buffer);
    const s1 = section(doc, "s1");
    const matrix = firstTable(s1.blocks);

    expect(s1.blocks.map((b) => b.kind)).toEqual(["paragraph", "table", "paragraph"]);
    expect(matrix.id).toBe("t1");
    expect(cellTexts(matrix)).toEqual([
      ["ID", "Requirement", "Acceptance criteria", "Priority"],
      ["FR-1", "Users can log in with SSO", "Login completes in < 2s", "Must"],
      ["FR-2", "Users can reset their password", "Reset email sent | logged", "Should"],
    ]);
    expect(matrix.rows[0]?.cells[0]).toMatchObject({ colSpan: 1, rowSpan: 1 });
    // Table cell paragraphs get ids in document order.
    expect(paragraphs(s1.blocks).map((p) => p.id)).toEqual([
      "p2",
      ...Array.from({ length: 12 }, (_, i) => `p${i + 3}`),
      "p15",
    ]);
  });

  it("handles header rows, merged cells and nested tables", async () => {
    const tableXml =
      `<w:tbl>` +
      `<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${para("Header")}</w:tc></w:tr>` +
      `<w:tr><w:tc>${para("Outer")}${table([["Inner A", "Inner B"]])}</w:tc><w:tc>${para("")}</w:tc></w:tr>` +
      `</w:tbl>`;
    const buffer = await buildDocx({ body: tableXml });

    const doc = await parseDocx(buffer);
    const outer = firstTable(section(doc, "s0").blocks);

    expect(outer.rows[0]?.isHeader).toBe(true);
    expect(outer.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(outer.rows[1]?.isHeader).toBe(false);
    const inner = firstTable(outer.rows[1]?.cells[0]?.blocks ?? []);
    expect(inner.id).toBe("t2");
    expect(cellTexts(inner)).toEqual([["Inner A", "Inner B"]]);
    expect(outer.rows[1]?.cells[1]?.blocks).toEqual([]);
  });

  it("does not treat heading-styled paragraphs inside tables as sections", async () => {
    const tableXml = `<w:tbl><w:tr><w:tc>${heading(1, "Cell heading")}</w:tc></w:tr></w:tbl>`;
    const buffer = await buildDocx({ body: tableXml });

    const doc = await parseDocx(buffer);

    expect(doc.hasHeadings).toBe(false);
    expect(allParagraphs(doc).map((p) => p.text)).toEqual(["Cell heading"]);
  });

  it("returns the accepted view of tracked changes", async () => {
    const buffer = await buildDocx({
      body:
        heading(1, "Scope") +
        paraXml(
          run("Users must ") + del("optionally ") + ins("always ") + run("verify their email.")
        ) +
        paraXml(del("This whole sentence was removed.")) +
        paraXml(ins("A newly inserted paragraph.")),
    });

    const doc = await parseDocx(buffer);

    expect(paragraphs(section(doc, "s1").blocks).map((p) => p.text)).toEqual([
      "Users must always verify their email.",
      "A newly inserted paragraph.",
    ]);
  });

  it("merges paragraphs whose paragraph mark was deleted", async () => {
    const deletedMark =
      `<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"/></w:rPr></w:pPr>${run("First half ")}</w:p>` +
      para("second half.");
    const buffer = await buildDocx({ body: deletedMark });

    const doc = await parseDocx(buffer);

    expect(allParagraphs(doc).map((p) => p.text)).toEqual(["First half second half."]);
  });

  describe("comments", () => {
    it("attaches comments to their anchor paragraph with the anchored text", async () => {
      const buffer = await buildDocx({
        body:
          heading(1, "Performance") +
          paraXml(
            run("The page should load ") +
              commentStart(0) +
              run("quickly") +
              commentEnd(0) +
              run(" on all devices.")
          ) +
          para("Unrelated paragraph."),
        comments: [
          { id: 0, author: "Jane Doe", initials: "JD", text: "How quickly? Define a target." },
        ],
      });

      const doc = await parseDocx(buffer);
      const [commented, unrelated] = paragraphs(section(doc, "s1").blocks);

      expect(commented?.text).toBe("The page should load quickly on all devices.");
      expect(commented?.commentIds).toEqual(["0"]);
      expect(unrelated?.commentIds).toEqual([]);
      expect(doc.comments).toEqual([
        {
          id: "0",
          author: "Jane Doe",
          initials: "JD",
          text: "How quickly? Define a target.",
          anchorText: "quickly",
          paragraphId: commented?.id,
          sectionId: "s1",
        },
      ]);
    });

    it("attaches a comment spanning paragraphs to the paragraph holding its reference", async () => {
      const buffer = await buildDocx({
        body:
          paraXml(commentStart(5) + run("First paragraph.")) +
          paraXml(run("Second paragraph.") + commentEnd(5)),
        comments: [{ id: 5, author: "Sam", text: "Merge these?" }],
      });

      const doc = await parseDocx(buffer);
      const [first, second] = allParagraphs(doc);

      expect(first?.commentIds).toEqual([]);
      expect(second?.commentIds).toEqual(["5"]);
      expect(doc.comments[0]).toMatchObject({
        anchorText: "First paragraph.\nSecond paragraph.",
        paragraphId: second?.id,
      });
    });

    it("attaches comments on headings and inside table cells", async () => {
      const buffer = await buildDocx({
        body:
          paraXml(commentStart(1) + run("Security") + commentEnd(1), "Heading1") +
          `<w:tbl><w:tr><w:tc>${paraXml(commentStart(2) + run("FR-9") + commentEnd(2))}</w:tc></w:tr></w:tbl>`,
        comments: [
          { id: 1, author: "A", text: "Expand this section." },
          { id: 2, author: "B", text: "Duplicate of FR-3?" },
        ],
      });

      const doc = await parseDocx(buffer);

      expect(doc.comments.map((c) => [c.id, c.paragraphId, c.sectionId])).toEqual([
        ["1", "p1", "s1"],
        ["2", "p2", "s1"],
      ]);
    });

    it("falls back to locating the anchor text when the reference is missing", async () => {
      const buffer = await buildDocx({
        body:
          para("Intro.") +
          paraXml(commentStart(7) + run("Payment retries") + '<w:commentRangeEnd w:id="7"/>') +
          paraXml(commentStart(8) + '<w:commentRangeEnd w:id="8"/>' + run("No anchor text.")),
        comments: [
          { id: 7, author: "A", text: "How many retries?" },
          { id: 8, author: "B", text: "Orphan." },
        ],
      });

      const doc = await parseDocx(buffer);

      expect(doc.comments.map((c) => [c.id, c.paragraphId, c.sectionId, c.anchorText])).toEqual([
        ["7", "p2", "s0", "Payment retries"],
        ["8", null, null, undefined],
      ]);
    });

    it("joins multi-paragraph comment bodies", async () => {
      const commentsXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:comment w:id="0" w:author=""><w:p>${run("Line 1")}</w:p><w:p/><w:p>${run("Line 2")}</w:p></w:comment>` +
        `</w:comments>`;
      const buffer = await buildDocx({
        body: paraXml(run("Text") + commentEnd(0)),
        comments: [{ id: 0, author: "placeholder", text: "placeholder" }],
        extraParts: { "word/comments.xml": commentsXml },
      });

      const doc = await parseDocx(buffer);

      expect(doc.comments[0]).toMatchObject({ author: "Unknown", text: "Line 1\nLine 2" });
    });
  });

  describe("images", () => {
    it("lists embedded images with their part path for later extraction", async () => {
      const buffer = await buildDocx({
        body:
          heading(1, "Flow") +
          para("See the diagram below.") +
          paraXml(imageRun("rIdImg1", "Login flow diagram")) +
          paraXml(run("Inline ") + imageRun("rIdImg2", "  ")),
        images: [
          { relId: "rIdImg1", fileName: "image1.png", data: TINY_PNG },
          {
            relId: "rIdImg2",
            fileName: "image2.png",
            data: Buffer.concat([TINY_PNG, Buffer.from([0])]),
          },
        ],
      });

      const doc = await parseDocx(buffer);
      const [, imagePara, inlinePara] = paragraphs(section(doc, "s1").blocks);

      expect(imagePara).toMatchObject({ text: "", imageIds: ["img1"] });
      expect(inlinePara).toMatchObject({ text: "Inline", imageIds: ["img2"] });
      expect(doc.images).toHaveLength(2);
      expect(doc.images[0]).toMatchObject({
        id: "img1",
        paragraphId: imagePara?.id,
        sectionId: "s1",
        contentType: "image/png",
        altText: "Login flow diagram",
        partPath: "word/media/image1.png",
        sizeBytes: TINY_PNG.length,
      });
      expect(doc.images[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(doc.images[1]).toMatchObject({ partPath: "word/media/image2.png" });
      expect(doc.images[1]?.altText).toBeUndefined();
      expect(doc.warnings).toEqual([]);
    });

    it("warns about images whose data cannot be read", async () => {
      const buffer = await buildDocx({
        body: paraXml(imageRun("rIdMissing", "Linked picture")),
        images: [],
      });
      // Point the relationship at a media file that does not exist.
      const zip = await JSZip.loadAsync(buffer);
      zip.file(
        "word/_rels/document.xml.rels",
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rIdMissing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/missing.png"/>` +
          `</Relationships>`
      );
      const broken = await zip.generateAsync({ type: "nodebuffer" });

      const doc = await parseDocx(broken);

      expect(doc.images).toHaveLength(1);
      expect(doc.images[0]).toMatchObject({ id: "img1", altText: "Linked picture" });
      expect(doc.images[0]?.sizeBytes).toBeUndefined();
      expect(doc.images[0]?.partPath).toBeUndefined();
      expect(doc.warnings.some((w) => w.includes("img1 could not be read"))).toBe(true);
    });
  });

  it("parses a document with no headings into a single preamble section", async () => {
    const buffer = await buildDocx({
      body: para("Paragraph one.") + para("Paragraph two.") + table([["A", "B"]]),
    });

    const doc = await parseDocx(buffer);

    expect(doc.hasHeadings).toBe(false);
    expect(doc.title).toBeUndefined();
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]).toMatchObject({ id: "s0", title: "", level: 0, headingPath: [] });
    expect(doc.sections[0]?.blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph", "table"]);
  });

  it("returns one empty section for an empty document", async () => {
    const doc = await parseDocx(await buildDocx({ body: "" }));

    expect(doc.sections).toEqual([
      {
        id: "s0",
        title: "",
        level: 0,
        headingPath: [],
        parentId: null,
        childIds: [],
        headingParagraphId: null,
        blocks: [],
      },
    ]);
    expect(doc.comments).toEqual([]);
    expect(doc.images).toEqual([]);
  });

  it("validates input before parsing", async () => {
    await expect(parseDocx(Buffer.from("not a docx"))).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws DocumentParseError when the zip has no readable document", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("word/styles.xml", "<w:styles/>");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    const error = await parseDocx(buffer).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DocumentParseError);
    expect((error as DocumentParseError).cause).toBeDefined();
  });
});

describe("parseDocxFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mm-docx-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads and parses a file from disk", async () => {
    const path = join(dir, "spec.docx");
    await writeFile(path, await buildDocx({ body: heading(1, "Hello") + para("World") }));

    const doc = await parseDocxFile(path, nodeFs);

    expect(doc.sections.map((s) => s.title)).toEqual(["Hello"]);
  });

  it("checks the size cap before reading the file", async () => {
    const fileSystem = createStubFileSystem({
      stat: vi.fn().mockResolvedValue({ size: 21 * 1024 * 1024 }),
    });

    await expect(parseDocxFile("/docs/huge.docx", fileSystem)).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(fileSystem.readFileBuffer).not.toHaveBeenCalled();
  });

  it("wraps read failures in DocumentParseError", async () => {
    const cause = new Error("ENOENT");
    const fileSystem = createStubFileSystem({ stat: vi.fn().mockRejectedValue(cause) });

    const error = await parseDocxFile("/docs/missing.docx", fileSystem).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DocumentParseError);
    expect((error as Error).message).toContain("could not read /docs/missing.docx");
    expect((error as Error).cause).toBe(cause);
  });
});
