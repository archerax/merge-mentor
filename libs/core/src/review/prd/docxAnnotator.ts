/**
 * Writes review findings into a copy of the reviewed `.docx` as Word comments,
 * so the author can work through them in the document itself.
 *
 * Each comment is anchored to the whole paragraph that contains the finding's
 * quoted text (splitting runs to anchor exactly on the quote is far more
 * fragile for little gain; the comment repeats the quote). The original file is
 * never modified: a new package is produced from the bytes passed in.
 */
import JSZip from "jszip";

import { findMainDocumentPath } from "./openXml.js";
import type { PrdFinding } from "./types.js";

const COMMENTS_PART = "word/comments.xml";
const COMMENTS_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
const COMMENTS_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const W_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const AUTHOR = "Merge Mentor";
const INITIALS = "MM";
/** Shortest fallback match (characters) when the whole quote is not in one paragraph. */
const MIN_PARTIAL_MATCH = 20;

/** Outcome of {@link annotateDocx}. */
export interface AnnotateResult {
  /** The annotated package. */
  readonly buffer: Buffer;
  /** Ids of the findings that were written as comments. */
  readonly placed: readonly string[];
  /** Ids of the findings whose text could not be located in a paragraph. */
  readonly unplaced: readonly string[];
}

interface ParagraphInfo {
  readonly start: number;
  readonly end: number;
  /** Normalized visible text. */
  readonly text: string;
  /** False for paragraphs that are unsafe to anchor into (text boxes, tracked formatting). */
  readonly anchorable: boolean;
}

const PARAGRAPH_PATTERN = /<w:p(?:\s[^>]*)?(?<!\/)>[\s\S]*?<\/w:p>/g;
const TEXT_PATTERN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:tab|br|noBreakHyphen)\b[^>]*\/>/g;

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Lowercases and folds whitespace and typographic quotes/dashes so quotes match Word text. */
function normalize(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\s ​]+/g, " ")
    .trim()
    .toLowerCase();
}

function paragraphText(paragraphXml: string): string {
  const visible = paragraphXml
    .replace(/<w:pPr>[\s\S]*?<\/w:pPr>/g, "")
    .replace(/<w:(?:del|moveFrom)\b[^>]*>[\s\S]*?<\/w:(?:del|moveFrom)>/g, "");
  let text = "";
  for (const match of visible.matchAll(TEXT_PATTERN)) {
    text += match[1] === undefined ? " " : decodeEntities(match[1]);
  }
  return normalize(text);
}

function scanParagraphs(documentXml: string): ParagraphInfo[] {
  const paragraphs: ParagraphInfo[] = [];
  for (const match of documentXml.matchAll(PARAGRAPH_PATTERN)) {
    const xml = match[0];
    paragraphs.push({
      start: match.index,
      end: match.index + xml.length,
      text: paragraphText(xml),
      anchorable:
        !xml.includes("<w:txbxContent") &&
        !xml.includes("<mc:AlternateContent") &&
        !xml.includes("<w:pPrChange"),
    });
  }
  return paragraphs;
}

/** The quote's search strings, best first: the whole quote, then its longest line. */
function searchTerms(quote: string): string[] {
  const whole = normalize(quote);
  if (whole.length === 0) return [];
  const terms = [whole];
  const longestLine = quote
    .split(/\n+/)
    .map((line) => normalize(line))
    .toSorted((a, b) => b.length - a.length)[0];
  if (longestLine && longestLine !== whole && longestLine.length >= MIN_PARTIAL_MATCH) {
    terms.push(longestLine);
  }
  return terms;
}

function findParagraph(
  paragraphs: readonly ParagraphInfo[],
  finding: PrdFinding,
  commentedCounts: ReadonlyMap<number, number>
): number {
  for (const term of searchTerms(finding.quote)) {
    const matches: number[] = [];
    paragraphs.forEach((paragraph, index) => {
      if (paragraph.anchorable && paragraph.text.includes(term)) matches.push(index);
    });
    if (matches.length === 0) continue;
    // Repeated phrases: spread findings over paragraphs that have no comment yet.
    return matches.find((index) => !commentedCounts.has(index)) ?? (matches[0] as number);
  }
  return -1;
}

function commentParagraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function commentXml(finding: PrdFinding, id: number, date: string): string {
  const lines = [`${finding.severity} · ${finding.dimensionName}: ${finding.problem}`];
  if (finding.suggestion) lines.push(`Suggestion: ${finding.suggestion}`);
  if (finding.authorQuestion) lines.push(`Question: ${finding.authorQuestion}`);
  return (
    `<w:comment w:id="${id}" w:author="${AUTHOR}" w:date="${date}" w:initials="${INITIALS}">` +
    lines.map((line) => commentParagraph(line)).join("") +
    `</w:comment>`
  );
}

function maxExistingId(xml: string): number {
  let max = -1;
  for (const match of xml.matchAll(/\bw:id\s*=\s*["'](\d+)["']/g)) {
    max = Math.max(max, Number(match[1]));
  }
  return max;
}

function relsPathFor(partPath: string): string {
  const slash = partPath.lastIndexOf("/");
  const dir = slash >= 0 ? partPath.slice(0, slash + 1) : "";
  return `${dir}_rels/${partPath.slice(slash + 1)}.rels`;
}

/**
 * Adds a Word comment for each finding whose quoted text can be found in the
 * document, and returns the new package.
 *
 * @param source - The reviewed `.docx` (already validated)
 * @param findings - Findings to write as comments
 * @param options - Timestamp for the comments
 * @throws {Error} when the package has no readable main document part
 */
export async function annotateDocx(
  source: Buffer,
  findings: readonly PrdFinding[],
  options: { readonly date: Date }
): Promise<AnnotateResult> {
  const zip = await JSZip.loadAsync(source);
  const packageRels = await zip.file("_rels/.rels")?.async("string");
  const mainPath = findMainDocumentPath(packageRels);
  const documentXml = await zip.file(mainPath)?.async("string");
  if (documentXml === undefined) throw new Error(`The document has no ${mainPath} part`);

  const paragraphs = scanParagraphs(documentXml);
  const existingComments = await zip.file(COMMENTS_PART)?.async("string");
  let nextId = Math.max(maxExistingId(documentXml), maxExistingId(existingComments ?? "")) + 1;
  const date = options.date.toISOString().replace(/\.\d{3}Z$/, "Z");

  const starts = new Map<number, string[]>();
  const ends = new Map<number, string[]>();
  const commentedCounts = new Map<number, number>();
  const comments: string[] = [];
  const placed: string[] = [];
  const unplaced: string[] = [];

  for (const finding of findings) {
    const index = findParagraph(paragraphs, finding, commentedCounts);
    if (index < 0) {
      unplaced.push(finding.id);
      continue;
    }
    const id = nextId++;
    comments.push(commentXml(finding, id, date));
    starts.set(index, [...(starts.get(index) ?? []), `<w:commentRangeStart w:id="${id}"/>`]);
    ends.set(index, [
      ...(ends.get(index) ?? []),
      `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`,
    ]);
    commentedCounts.set(index, (commentedCounts.get(index) ?? 0) + 1);
    placed.push(finding.id);
  }

  if (comments.length === 0) {
    return { buffer: Buffer.from(source), placed, unplaced };
  }

  // Splice from the end so earlier offsets stay valid.
  let updated = documentXml;
  for (const index of [...starts.keys()].toSorted((a, b) => b - a)) {
    const paragraph = paragraphs[index] as ParagraphInfo;
    const xml = documentXml.slice(paragraph.start, paragraph.end);
    const openEnd = xml.indexOf(">") + 1;
    let insertAt = openEnd;
    if (/^<w:pPr[\s>]/.test(xml.slice(openEnd))) {
      insertAt = openEnd + xml.slice(openEnd).indexOf("</w:pPr>") + "</w:pPr>".length;
    }
    const rebuilt =
      xml.slice(0, insertAt) +
      (starts.get(index) ?? []).join("") +
      xml.slice(insertAt, xml.length - "</w:p>".length) +
      (ends.get(index) ?? []).join("") +
      "</w:p>";
    updated = updated.slice(0, paragraph.start) + rebuilt + updated.slice(paragraph.end);
  }
  zip.file(mainPath, updated);

  if (existingComments === undefined) {
    zip.file(
      COMMENTS_PART,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:comments xmlns:w="${W_NAMESPACE}">${comments.join("")}</w:comments>`
    );
    await registerCommentsPart(zip, mainPath);
  } else {
    zip.file(
      COMMENTS_PART,
      existingComments.replace(/<\/w:comments>\s*$/, `${comments.join("")}</w:comments>`)
    );
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer, placed, unplaced };
}

/** Adds the content type override and the relationship for a new comments part. */
async function registerCommentsPart(zip: JSZip, mainPath: string): Promise<void> {
  const contentTypes = await zip.file("[Content_Types].xml")?.async("string");
  if (contentTypes !== undefined && !contentTypes.includes("/word/comments.xml")) {
    zip.file(
      "[Content_Types].xml",
      contentTypes.replace(
        "</Types>",
        `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CONTENT_TYPE}"/></Types>`
      )
    );
  }

  const relsPath = relsPathFor(mainPath);
  const rels = await zip.file(relsPath)?.async("string");
  const target = COMMENTS_PART.replace(/^word\//, "");
  const relationship = `<Relationship Id="rIdMmComments" Type="${COMMENTS_REL_TYPE}" Target="${target}"/>`;
  if (rels === undefined) {
    zip.file(
      relsPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationship}</Relationships>`
    );
  } else if (!rels.includes(COMMENTS_REL_TYPE)) {
    zip.file(relsPath, rels.replace("</Relationships>", `${relationship}</Relationships>`));
  }
}
