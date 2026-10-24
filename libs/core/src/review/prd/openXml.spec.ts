import { describe, expect, it } from "vitest";

import {
  extractCommentAnchors,
  findMainDocumentPath,
  MAX_ACCUMULATING_RANGES,
  MAX_ANCHOR_CHARS,
} from "./openXml.js";

const t = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

describe("extractCommentAnchors", () => {
  it("returns the text between range start and end", () => {
    const xml = `<w:body><w:p>${t("Before ")}<w:commentRangeStart w:id="3"/>${t("anchored")}<w:commentRangeEnd w:id="3"/>${t(" after")}</w:p></w:body>`;
    expect(extractCommentAnchors(xml)).toEqual(new Map([["3", "anchored"]]));
  });

  it("joins multi-paragraph ranges with newlines and handles overlapping ranges", () => {
    const xml =
      `<w:p><w:commentRangeStart w:id="1"/>${t("one")}</w:p>` +
      `<w:p><w:commentRangeStart w:id="2"/>${t("two")}<w:commentRangeEnd w:id="1"/>${t(" three")}<w:commentRangeEnd w:id="2"/></w:p>`;
    const anchors = extractCommentAnchors(xml);
    expect(anchors.get("1")).toBe("one\ntwo");
    expect(anchors.get("2")).toBe("two three");
  });

  it("keeps tabs and line breaks inside the range, but not outside it", () => {
    const xml =
      `<w:p><w:r><w:tab/></w:r><w:commentRangeStart w:id="1"/>${t("Name")}<w:r><w:tab/></w:r>${t("Value")}` +
      `<w:r><w:br/></w:r>${t("next")}<w:r><w:cr/></w:r>${t("last")}<w:commentRangeEnd w:id="1"/><w:r><w:br/></w:r>${t("after")}</w:p>`;
    expect(extractCommentAnchors(xml).get("1")).toBe("Name\tValue\nnext\nlast");
  });

  it("excludes deleted, moved-from and fallback content (accepted view)", () => {
    const xml =
      `<w:p><w:commentRangeStart w:id="1"/>${t("kept ")}` +
      `<w:del w:id="9" w:author="A"><w:r><w:delText>gone</w:delText></w:r></w:del>` +
      `<w:moveFrom><w:r><w:t>moved</w:t></w:r></w:moveFrom>` +
      `<w:ins w:id="8">${t("added")}</w:ins>` +
      `<mc:AlternateContent><mc:Choice>${t(" choice")}</mc:Choice><mc:Fallback>${t(" fallback")}</mc:Fallback></mc:AlternateContent>` +
      `<w:commentRangeEnd w:id="1"/></w:p>`;
    expect(extractCommentAnchors(xml).get("1")).toBe("kept added choice");
  });

  it("decodes XML entities", () => {
    const xml = `<w:p><w:commentRangeStart w:id="1"/>${t("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#65;&#x42; &#xFFFFFFF;")}<w:commentRangeEnd w:id="1"/></w:p>`;
    expect(extractCommentAnchors(xml).get("1")).toBe(`a & b <c> "d" 'e' AB &#xFFFFFFF;`);
  });

  it("omits empty ranges and ignores markers without ids", () => {
    const xml = `<w:p><w:commentRangeStart w:id="1"/><w:commentRangeEnd w:id="1"/><w:commentRangeStart/>${t("x")}</w:p>`;
    expect(extractCommentAnchors(xml).size).toBe(0);
  });

  it("ignores attribute values containing '>'", () => {
    const xml = `<w:p><w:commentRangeStart w:id="1"/><w:r w:x="a>b"><w:t>text</w:t></w:r><w:commentRangeEnd w:id="1"/></w:p>`;
    expect(extractCommentAnchors(xml).get("1")).toBe("text");
  });
});

describe("extractCommentAnchors bounds", () => {
  it("truncates long anchors with an ellipsis marker", () => {
    const xml = `<w:p><w:commentRangeStart w:id="1"/>${t("x".repeat(MAX_ANCHOR_CHARS * 5))}<w:commentRangeEnd w:id="1"/></w:p>`;
    const anchor = extractCommentAnchors(xml).get("1") ?? "";
    expect(anchor.startsWith("x".repeat(MAX_ANCHOR_CHARS))).toBe(true);
    expect(anchor.endsWith("…")).toBe(true);
    expect(anchor.length).toBeLessThanOrEqual(MAX_ANCHOR_CHARS + 2);
  });

  it("bounds total retained text for many overlapping ranges over large text", () => {
    const ranges = 5_000;
    const starts = Array.from(
      { length: ranges },
      (_, i) => `<w:commentRangeStart w:id="${i}"/>`
    ).join("");
    const body = Array.from({ length: 200 }, () => `<w:p>${t("y".repeat(5_000))}</w:p>`).join("");
    const xml = `<w:body>${starts}${body}</w:body>`;
    const anchors = extractCommentAnchors(xml);
    expect(anchors.size).toBeLessThanOrEqual(MAX_ACCUMULATING_RANGES);
    let total = 0;
    for (const anchor of anchors.values()) {
      expect(anchor.length).toBeLessThanOrEqual(MAX_ANCHOR_CHARS + 2);
      total += anchor.length;
    }
    expect(total).toBeLessThanOrEqual(MAX_ACCUMULATING_RANGES * (MAX_ANCHOR_CHARS + 2));
  });
});

describe("findMainDocumentPath", () => {
  it("defaults to word/document.xml", () => {
    expect(findMainDocumentPath(undefined)).toBe("word/document.xml");
    expect(findMainDocumentPath("<Relationships/>")).toBe("word/document.xml");
  });

  it("reads the officeDocument relationship target", () => {
    const rels = `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/word/document2.xml"/></Relationships>`;
    expect(findMainDocumentPath(rels)).toBe("word/document2.xml");
  });
});
