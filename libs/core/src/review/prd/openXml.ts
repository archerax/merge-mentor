/**
 * Direct OpenXML reading for the parts mammoth does not expose.
 *
 * Mammoth reports where a comment's *reference* sits but drops the commented
 * range (`w:commentRangeStart` .. `w:commentRangeEnd`), so the anchor text is
 * read from `word/document.xml` here with a small tag tokenizer. The XML is
 * machine-written by Word, so a full DOM is not needed.
 */

const DEFAULT_MAIN_DOCUMENT_PATH = "word/document.xml";

/** Elements whose text is not part of the accepted view of the document. */
const SKIPPED_ELEMENTS = new Set(["w:del", "w:moveFrom", "mc:Fallback"]);

const TOKEN_PATTERN = /<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
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

  for (const match of documentXml.matchAll(TOKEN_PATTERN)) {
    const [, closing, name, attributes = "", selfClosing, text] = match;
    if (text !== undefined) {
      if (inText && skipDepth === 0 && open.size > 0) {
        const decoded = decodeXmlEntities(text);
        for (const id of open) buffers.set(id, (buffers.get(id) ?? "") + decoded);
      }
      continue;
    }
    if (name === undefined) continue;

    if (name === "w:commentRangeStart" || name === "w:commentRangeEnd") {
      const id = ID_ATTRIBUTE.exec(attributes)?.[1];
      if (id === undefined) continue;
      if (name === "w:commentRangeStart") {
        open.add(id);
        if (!buffers.has(id)) buffers.set(id, "");
      } else {
        open.delete(id);
      }
      continue;
    }
    if (!closing && skipDepth === 0 && open.size > 0) {
      const whitespace = name === "w:tab" ? "\t" : name === "w:br" || name === "w:cr" ? "\n" : "";
      if (whitespace) {
        for (const id of open) buffers.set(id, (buffers.get(id) ?? "") + whitespace);
      }
    }
    if (selfClosing) continue;

    if (SKIPPED_ELEMENTS.has(name)) {
      skipDepth = Math.max(0, skipDepth + (closing ? -1 : 1));
    } else if (name === "w:t") {
      inText = !closing;
    } else if (name === "w:p" && closing && skipDepth === 0) {
      for (const id of open) buffers.set(id, `${buffers.get(id) ?? ""}\n`);
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
