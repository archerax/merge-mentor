/**
 * Direct OpenXML reading for the parts mammoth does not expose.
 *
 * Mammoth reports where a comment's *reference* sits but drops the commented
 * range (`w:commentRangeStart` .. `w:commentRangeEnd`), so the anchor text is
 * read from `word/document.xml` here with a small tag tokenizer. The XML is
 * machine-written by Word, so a full DOM is not needed.
 */

/** Characters kept per comment anchor; anchors are only context for the model. */
export const MAX_ANCHOR_CHARS = 2_000;
/** Overlapping comment ranges that accumulate text at once (the rest stay empty). */
export const MAX_ACCUMULATING_RANGES = 32;
/** Distinct comment range ids tracked per document; further ranges get no anchor. */
export const MAX_TRACKED_RANGES = 5_000;
const TRUNCATION_MARKER = "…";

const DEFAULT_MAIN_DOCUMENT_PATH = "word/document.xml";

/**
 * Elements whose text is not part of the accepted view of the document.
 * Mammoth reads only `mc:Fallback` of an `mc:AlternateContent` (never its
 * `mc:Choice` branches), so anchors follow the same selection.
 */
const SKIPPED_ELEMENTS = new Set(["w:del", "w:moveFrom", "mc:Choice"]);

/**
 * Tokens, in order: comments and processing instructions (skipped whole, an
 * unterminated one swallows the rest as an XML parser would reject it), CDATA
 * (literal text, never markup), tags, and plain text.
 */
const TOKEN_PATTERN =
  /<!--[\s\S]*?(?:-->|$)|<\?[\s\S]*?(?:\?>|$)|<!\[CDATA\[([\s\S]*?)(?:\]\]>|$)|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
const ID_ATTRIBUTE = /\bw:id\s*=\s*["']([^"']*)["']/;

const OFFICE_DOCUMENT_REL = /<Relationship\b[^>]*\bType\s*=\s*["'][^"']*\/officeDocument["'][^>]*>/;
const TARGET_ATTRIBUTE = /\bTarget\s*=\s*["']([^"']*)["']/;

/**
 * Resolves the main document part from `_rels/.rels` (normally
 * `word/document.xml`).
 */
export function findMainDocumentPath(packageRelsXml: string | undefined): string {
  if (!packageRelsXml) return DEFAULT_MAIN_DOCUMENT_PATH;
  const rel = OFFICE_DOCUMENT_REL.exec(packageRelsXml);
  const target = rel ? TARGET_ATTRIBUTE.exec(rel[0])?.[1] : undefined;
  if (!target) return DEFAULT_MAIN_DOCUMENT_PATH;
  return target.replace(/^\/+/, "");
}

/**
 * Returns the accepted-view text covered by each comment range, keyed by
 * comment id. Deleted text is excluded; paragraph breaks become newlines.
 */
export function extractCommentAnchors(documentXml: string): Map<string, string> {
  const buffers = new Map<string, string>();
  const open = new Set<string>();
  let skipDepth = 0;
  let inText = false;

  const append = (value: string): void => {
    let accumulating = 0;
    for (const id of open) {
      if (accumulating++ >= MAX_ACCUMULATING_RANGES) break;
      const current = buffers.get(id) ?? "";
      if (current.length > MAX_ANCHOR_CHARS) continue;
      const next = current + value;
      buffers.set(
        id,
        next.length > MAX_ANCHOR_CHARS
          ? `${next.slice(0, MAX_ANCHOR_CHARS)}\n${TRUNCATION_MARKER}`
          : next
      );
    }
  };

  for (const match of documentXml.matchAll(TOKEN_PATTERN)) {
    const [whole, cdata, closing, name, attributes = "", selfClosing, text] = match;
    if (cdata !== undefined) {
      if (inText && skipDepth === 0 && open.size > 0) append(cdata);
      continue;
    }
    if (text !== undefined) {
      if (inText && skipDepth === 0 && open.size > 0) {
        append(decodeXmlEntities(text));
      }
      continue;
    }
    if (whole.startsWith("<!--") || whole.startsWith("<?")) continue;
    if (name === undefined) continue;

    if (name === "w:commentRangeStart" || name === "w:commentRangeEnd") {
      const id = ID_ATTRIBUTE.exec(attributes)?.[1];
      if (id === undefined) continue;
      if (name === "w:commentRangeStart") {
        if (!buffers.has(id)) {
          if (buffers.size >= MAX_TRACKED_RANGES) continue;
          buffers.set(id, "");
        }
        open.add(id);
      } else {
        open.delete(id);
      }
      continue;
    }
    if (!closing && skipDepth === 0 && open.size > 0) {
      const whitespace = name === "w:tab" ? "\t" : name === "w:br" || name === "w:cr" ? "\n" : "";
      if (whitespace) append(whitespace);
    }
    if (selfClosing) continue;

    if (SKIPPED_ELEMENTS.has(name)) {
      skipDepth = Math.max(0, skipDepth + (closing ? -1 : 1));
    } else if (name === "w:t") {
      inText = !closing;
    } else if (name === "w:p" && closing && skipDepth === 0) {
      append("\n");
    }
  }

  const anchors = new Map<string, string>();
  for (const [id, raw] of buffers) {
    const normalized = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");
    if (normalized.length > 0) anchors.set(id, normalized);
  }
  return anchors;
}

function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (entity, body: string) => {
    switch (body) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        const code = body.startsWith("#x")
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
      }
    }
  });
}
