import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { annotateDocx } from "./docxAnnotator.js";
import {
  buildDocx,
  commentEnd,
  commentStart,
  del,
  heading,
  para,
  paraXml,
  run,
} from "./docxFixture.test-helper.js";
import { parseDocx } from "./docxParser.js";
import type { PrdFinding } from "./types.js";

const DATE = new Date("2026-11-06T10:00:00.000Z");

function finding(id: string, overrides: Partial<PrdFinding> = {}): PrdFinding {
  return {
    id,
    severity: "Major",
    dimension: "scope",
    dimensionName: "Scope",
    sectionId: "s1",
    headingPath: ["Scope"],
    quote: "Card payments are in scope.",
    problem: "It is unclear which cards.",
    suggestion: "List the card types.",
    authorQuestion: "Which cards?",
    origin: "section",
    ...overrides,
  };
}

async function partText(buffer: Buffer, name: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return (await zip.file(name)?.async("string")) ?? "";
}

describe("annotateDocx", () => {
  it("adds a comment on the paragraph that holds the quote and keeps the file readable", async () => {
    const source = await buildDocx({
      body: heading(1, "Scope") + para("Card payments are in scope.") + para("Refunds later."),
    });
    const result = await annotateDocx(source, [finding("f1")], { date: DATE });

    expect(result.placed).toEqual(["f1"]);
    expect(result.unplaced).toEqual([]);
    const comments = await partText(result.buffer, "word/comments.xml");
    expect(comments).toContain('w:author="Merge Mentor"');
    expect(comments).toContain("Major · Scope: It is unclear which cards.");
    expect(comments).toContain("Suggestion: List the card types.");
    expect(comments).toContain("Question: Which cards?");

    const parsed = await parseDocx(result.buffer);
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0]?.text).toContain("It is unclear which cards.");
  });

  it("registers the comments part in the content types and relationships", async () => {
    const source = await buildDocx({ body: para("Card payments are in scope.") });
    const result = await annotateDocx(source, [finding("f1")], { date: DATE });
    expect(await partText(result.buffer, "[Content_Types].xml")).toContain("/word/comments.xml");
    expect(await partText(result.buffer, "word/_rels/document.xml.rels")).toContain(
      "relationships/comments"
    );
  });

  it("does not change the source bytes", async () => {
    const source = await buildDocx({ body: para("Card payments are in scope.") });
    const copy = Buffer.from(source);
    await annotateDocx(source, [finding("f1")], { date: DATE });
    expect(source.equals(copy)).toBe(true);
  });

  it("appends to existing comments with fresh ids", async () => {
    const source = await buildDocx({
      body: paraXml(commentStart(0) + run("Card payments are in scope.") + commentEnd(0)),
      comments: [{ id: 0, author: "Pat", text: "Check with legal." }],
    });
    const result = await annotateDocx(source, [finding("f1")], { date: DATE });
    const comments = await partText(result.buffer, "word/comments.xml");
    expect(comments).toContain("Check with legal.");
    expect(comments).toContain('w:id="1"');
    expect((await parseDocx(result.buffer)).comments).toHaveLength(2);
  });

  it("matches across smart quotes, spacing and split runs", async () => {
    const source = await buildDocx({
      body: paraXml(run("Users can’t  ") + run("log in")),
    });
    const result = await annotateDocx(source, [finding("f1", { quote: "Users can't log in" })], {
      date: DATE,
    });
    expect(result.placed).toEqual(["f1"]);
  });

  it("ignores text inside tracked deletions", async () => {
    const source = await buildDocx({ body: paraXml(run("Kept text. ") + del("Removed words.")) });
    const result = await annotateDocx(source, [finding("f1", { quote: "Removed words." })], {
      date: DATE,
    });
    expect(result.unplaced).toEqual(["f1"]);
  });

  it("reports findings it cannot place and returns the source unchanged when none are placed", async () => {
    const source = await buildDocx({ body: para("Something else entirely.") });
    const result = await annotateDocx(source, [finding("f1")], { date: DATE });
    expect(result.placed).toEqual([]);
    expect(result.unplaced).toEqual(["f1"]);
    expect(result.buffer.equals(source)).toBe(true);
  });

  it("puts several findings on one paragraph and spreads repeated quotes", async () => {
    const source = await buildDocx({
      body: para("Card payments are in scope.") + para("Card payments are in scope."),
    });
    const result = await annotateDocx(
      source,
      [
        finding("f1"),
        finding("f2", { problem: "Second problem." }),
        finding("f3", { problem: "Third." }),
      ],
      { date: DATE }
    );
    expect(result.placed).toEqual(["f1", "f2", "f3"]);
    const parsed = await parseDocx(result.buffer);
    expect(parsed.comments).toHaveLength(3);
  });

  it("escapes markup in finding text", async () => {
    const source = await buildDocx({ body: para("Card payments are in scope.") });
    const result = await annotateDocx(
      source,
      [finding("f1", { problem: "Uses <b>&</b> badly." })],
      { date: DATE }
    );
    expect(await partText(result.buffer, "word/comments.xml")).toContain(
      "Uses &lt;b&gt;&amp;&lt;/b&gt; badly."
    );
  });
});
