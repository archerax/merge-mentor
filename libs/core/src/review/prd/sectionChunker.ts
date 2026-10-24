/**
 * Splits a parsed document into chunks that each fit one model call.
 *
 * With headings: a top-level section and all of its subsections become one
 * chunk when they fit in `maxChars`; otherwise the section's own content is a
 * chunk and each subsection is considered in turn. A section whose own content
 * is still too large is split at paragraph/table boundaries (oversized single
 * blocks are split at whitespace) with `overlapChars` of overlap, repeating the
 * heading on every part. Small neighbouring chunks are then merged so a
 * document with many short sections does not cost one call per heading.
 *
 * Without headings: the content is cut into fixed-size chunks of
 * `fallbackChunkChars` with `overlapChars` of overlap, at block boundaries.
 *
 * Sizes are in characters of rendered text (roughly 4 characters per token).
 */
import { ValidationError } from "@merge-mentor/shared/errors/index.js";

import type {
  DocumentChunk,
  DocxBlock,
  DocxComment,
  DocxDocument,
  DocxImage,
  DocxParagraph,
  DocxSection,
  DocxTable,
} from "./types.js";

export interface ChunkOptions {
  /** Maximum rendered size of a chunk when splitting by headings. */
  readonly maxChars?: number;
  /** Chunks smaller than this are merged with a neighbour when the result fits. */
  readonly minChars?: number;
  /** Chunk size for documents without headings. */
  readonly fallbackChunkChars?: number;
  /** Overlap between consecutive parts of split content. */
  readonly overlapChars?: number;
}

/** Defaults settled in the spike (see ideas/prd-review-plan.md, section 9). */
export const DEFAULT_CHUNK_OPTIONS: Required<ChunkOptions> = {
  maxChars: 24_000,
  minChars: 4_000,
  fallbackChunkChars: 12_000,
  overlapChars: 1_500,
};

/**
 * The heading label shown in a chunk header is capped at this fraction of
 * `maxChars`, so a very long heading path cannot leave no room for the body.
 */
const HEADING_FRACTION = 4;

/** A rendered fragment of a section; the unit that packing works with. */
interface Piece {
  readonly text: string;
  readonly paragraphIds: readonly string[];
}

interface DraftChunk {
  readonly sectionIds: string[];
  readonly headingPath: readonly string[];
  readonly text: string;
  readonly paragraphIds: string[];
  readonly part?: { readonly index: number; readonly total: number };
}

/**
 * Splits `document` into model-sized chunks, in document order.
 *
 * @throws {ValidationError} if the options are inconsistent
 */
export function chunkDocument(document: DocxDocument, options: ChunkOptions = {}): DocumentChunk[] {
  const resolved = resolveOptions(options);
  const renderer = new Renderer(document, Math.floor(resolved.maxChars / HEADING_FRACTION));
  const drafts = document.hasHeadings
    ? chunkByHeadings(document, renderer, resolved)
    : chunkFixedSize(document, renderer, resolved);
  return drafts.map((draft, index) => ({
    id: `c${index + 1}`,
    sectionIds: draft.sectionIds,
    headingPath: draft.headingPath,
    text: draft.text,
    paragraphIds: draft.paragraphIds,
    ...(draft.part ? { part: draft.part } : {}),
  }));
}

function resolveOptions(options: ChunkOptions): Required<ChunkOptions> {
  const resolved = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const { maxChars, minChars, fallbackChunkChars, overlapChars } = resolved;
  const sizes = [maxChars, fallbackChunkChars];
  if (sizes.some((size) => !Number.isFinite(size) || size <= 0)) {
    throw new ValidationError("chunkOptions", "chunk sizes must be positive numbers");
  }
  if (![minChars, overlapChars].every((size) => Number.isFinite(size) && size >= 0)) {
    throw new ValidationError(
      "chunkOptions",
      "minChars and overlapChars must be finite and not negative"
    );
  }
  if (overlapChars * 2 > Math.min(maxChars, fallbackChunkChars)) {
    throw new ValidationError("chunkOptions", "overlapChars must be at most half the chunk size");
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Heading mode
// ---------------------------------------------------------------------------

function chunkByHeadings(
  document: DocxDocument,
  renderer: Renderer,
  options: Required<ChunkOptions>
): DraftChunk[] {
  const byId = new Map(document.sections.map((section) => [section.id, section]));
  const drafts: DraftChunk[] = [];

  const subtree = (section: DocxSection): DocxSection[] => [
    section,
    ...section.childIds.flatMap((id) => {
      const child = byId.get(id);
      return child ? subtree(child) : [];
    }),
  ];

  const visit = (section: DocxSection): void => {
    const sections = subtree(section).filter(hasContent);
    if (sections.length === 0) return;
    const whole = joinPieces(sections.map((s) => renderer.section(s)).flat());
    if (whole.text.length <= options.maxChars) {
      drafts.push({
        sectionIds: sections.map((s) => s.id),
        headingPath: section.headingPath,
        ...whole,
      });
      return;
    }

    if (section.blocks.length > 0 || section.childIds.length === 0) {
      const own = renderer.section(section);
      const ownJoined = joinPieces(own);
      if (ownJoined.text.length <= options.maxChars) {
        drafts.push({ sectionIds: [section.id], headingPath: section.headingPath, ...ownJoined });
      } else {
        drafts.push(...splitSection(section, renderer, options));
      }
    }
    for (const childId of section.childIds) {
      const child = byId.get(childId);
      if (child) visit(child);
    }
  };

  for (const section of document.sections) {
    if (section.parentId === null) visit(section);
  }
  return mergeSmall(drafts, options);
}

function hasContent(section: DocxSection): boolean {
  return section.blocks.length > 0 || section.headingParagraphId !== null;
}

function splitSection(
  section: DocxSection,
  renderer: Renderer,
  options: Required<ChunkOptions>
): DraftChunk[] {
  if (section.blocks.length === 0) {
    // A heading with no content of its own (and no children to carry it): keep
    // the heading as a chunk instead of letting it vanish.
    const [heading] = renderer.section(section);
    return heading
      ? [{ sectionIds: [section.id], headingPath: section.headingPath, ...joinPieces([heading]) }]
      : [];
  }
  // Budget for the longest header any part can carry (part numbers are not
  // known until the body is packed) plus the blank line before the body, and
  // always leave a positive body budget even when the header is long.
  const longestHeader = renderer.header(section, { index: 99_999, total: 99_999 });
  const budget = Math.max(
    Math.ceil(options.maxChars / 2),
    options.maxChars - longestHeader.length - "\n\n".length
  );
  const pieces = section.blocks.map((block) => renderer.block(block));
  // The header is repeated per part, so the heading's comments ride with the
  // first block instead.
  const headingComments = renderer.headingComments(section);
  if (headingComments.length > 0) {
    pieces.unshift({ text: headingComments.join("\n"), paragraphIds: [] });
  }
  const groups = packWithOverlap(pieces, budget, options.overlapChars);
  return groups.map((group, index) => {
    const part = { index: index + 1, total: groups.length };
    const body = joinPieces(group);
    const head = renderer.header(section, part);
    return {
      sectionIds: [section.id],
      headingPath: section.headingPath,
      text: head ? `${head}\n\n${body.text}` : body.text,
      // The heading line is shown in every part's header, so each part carries it.
      paragraphIds: section.headingParagraphId
        ? [section.headingParagraphId, ...body.paragraphIds]
        : body.paragraphIds,
      part,
    };
  });
}

function mergeSmall(drafts: DraftChunk[], options: Required<ChunkOptions>): DraftChunk[] {
  const merged: DraftChunk[] = [];
  for (const draft of drafts) {
    const previous = merged.at(-1);
    const small =
      previous !== undefined &&
      (previous.text.length < options.minChars || draft.text.length < options.minChars);
    if (
      previous &&
      small &&
      !previous.part &&
      !draft.part &&
      previous.text.length + draft.text.length + 2 <= options.maxChars
    ) {
      merged[merged.length - 1] = {
        sectionIds: [...previous.sectionIds, ...draft.sectionIds],
        headingPath: previous.headingPath,
        text: `${previous.text}\n\n${draft.text}`,
        paragraphIds: [...previous.paragraphIds, ...draft.paragraphIds],
      };
    } else {
      merged.push(draft);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Fallback mode (no headings)
// ---------------------------------------------------------------------------

function chunkFixedSize(
  document: DocxDocument,
  renderer: Renderer,
  options: Required<ChunkOptions>
): DraftChunk[] {
  const sectionIds = document.sections.map((section) => section.id);
  const pieces = document.sections.flatMap((section) =>
    section.blocks.map((block) => renderer.block(block))
  );
  if (pieces.length === 0) return [];
  return packWithOverlap(pieces, options.fallbackChunkChars, options.overlapChars).map((group) => ({
    sectionIds,
    headingPath: [],
    ...joinPieces(group),
  }));
}

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

/**
 * Packs pieces into groups of at most `size` characters. Each group after the
 * first starts with trailing pieces of the previous group totalling at most
 * `overlap` characters. Pieces larger than `size` are split first.
 */
function packWithOverlap(pieces: readonly Piece[], size: number, overlap: number): Piece[][] {
  const units = pieces.flatMap((piece) => splitPiece(piece, size, overlap));
  const groups: Piece[][] = [];
  let start = 0;
  while (start < units.length) {
    let end = start;
    let length = 0;
    while (end < units.length) {
      const next = (units[end]?.text.length ?? 0) + (end > start ? 2 : 0);
      if (end > start && length + next > size) break;
      length += next;
      end += 1;
    }
    groups.push(units.slice(start, end));
    if (end >= units.length) break;

    let overlapStart = end;
    let overlapLength = 0;
    while (overlapStart - 1 > start) {
      const previous = (units[overlapStart - 1]?.text.length ?? 0) + 2;
      if (overlapLength + previous > overlap) break;
      overlapLength += previous;
      overlapStart -= 1;
    }
    start = overlapStart;
  }
  return groups;
}

/** Splits one oversized piece at whitespace into overlapping slices. */
function splitPiece(piece: Piece, size: number, overlap: number): Piece[] {
  if (piece.text.length <= size) return [piece];
  const slices: Piece[] = [];
  let start = 0;
  while (start < piece.text.length) {
    let end = Math.min(start + size, piece.text.length);
    if (end < piece.text.length) {
      const boundary = piece.text.lastIndexOf(" ", end);
      if (boundary > start + size / 2) end = boundary;
    }
    const text = piece.text.slice(start, end).trim();
    slices.push({ text, paragraphIds: idsInSlice(piece, text, slices.at(-1)) });
    if (end >= piece.text.length) break;
    let next = end - overlap;
    const boundary = piece.text.indexOf(" ", next);
    if (boundary !== -1 && boundary < end) next = boundary + 1;
    start = Math.max(next, start + 1);
  }
  return slices;
}

/**
 * The paragraph ids of `piece` that appear (as `[id]` markers) in one slice of
 * its text, so a slice of a large table does not claim the whole table's
 * paragraphs. A slice that starts inside a paragraph continues the previous
 * slice's last paragraph.
 */
function idsInSlice(piece: Piece, text: string, previous: Piece | undefined): string[] {
  if (piece.paragraphIds.length <= 1) return [...piece.paragraphIds];
  const found = piece.paragraphIds
    .map((id) => ({ id, at: text.indexOf(`[${id}]`) }))
    .filter((entry) => entry.at !== -1)
    .toSorted((a, b) => a.at - b.at);
  const ids = found.map((entry) => entry.id);
  const continued = previous?.paragraphIds.at(-1);
  if (continued !== undefined && !ids.includes(continued) && (found[0]?.at ?? 1) > 0) {
    ids.unshift(continued);
  }
  return ids;
}

function joinPieces(pieces: readonly Piece[]): { text: string; paragraphIds: string[] } {
  const paragraphIds: string[] = [];
  for (const piece of pieces) {
    for (const id of piece.paragraphIds) if (!paragraphIds.includes(id)) paragraphIds.push(id);
  }
  return { text: pieces.map((piece) => piece.text).join("\n\n"), paragraphIds };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Renders the document model as plain text for the model. Paragraphs carry
 * their ids (`[p12]`) so findings can point back to them; existing comments
 * and images are shown in place.
 */
class Renderer {
  private readonly comments: Map<string, DocxComment>;
  /** Comments by the paragraph they are anchored to (used for heading paragraphs). */
  private readonly commentsByParagraph = new Map<string, DocxComment[]>();
  private readonly images: Map<string, DocxImage>;

  constructor(
    document: DocxDocument,
    private readonly maxHeadingChars: number
  ) {
    this.comments = new Map(document.comments.map((comment) => [comment.id, comment]));
    this.images = new Map(document.images.map((image) => [image.id, image]));
    for (const comment of document.comments) {
      if (comment.paragraphId === null) continue;
      const list = this.commentsByParagraph.get(comment.paragraphId) ?? [];
      list.push(comment);
      this.commentsByParagraph.set(comment.paragraphId, list);
    }
  }

  /** The comments on a section's heading paragraph, one line each. */
  headingComments(section: DocxSection): string[] {
    if (!section.headingParagraphId) return [];
    return (this.commentsByParagraph.get(section.headingParagraphId) ?? []).map((comment) =>
      this.comment(comment)
    );
  }

  /** The heading line plus one piece per block. */
  section(section: DocxSection): Piece[] {
    const header = this.header(section, undefined);
    const pieces = section.blocks.map((block) => this.block(block));
    if (!header) return pieces;
    const headingIds = section.headingParagraphId ? [section.headingParagraphId] : [];
    const text = [header, ...this.headingComments(section)].join("\n");
    return [{ text, paragraphIds: headingIds }, ...pieces];
  }

  header(section: DocxSection, part: { index: number; total: number } | undefined): string {
    if (section.level === 0) return "";
    const suffix = part ? ` (part ${part.index} of ${part.total})` : "";
    const marks = "#".repeat(Math.min(section.level, 6));
    return `${marks} ${this.headingLabel(section)} [${section.id}]${suffix}`;
  }

  /** The heading path, keeping its deepest part when it is longer than the cap. */
  private headingLabel(section: DocxSection): string {
    const label = section.headingPath.join(" > ");
    const cap = Math.max(1, this.maxHeadingChars);
    return label.length <= cap ? label : `…${label.slice(label.length - (cap - 1))}`;
  }

  block(block: DocxBlock): Piece {
    if (block.kind === "paragraph") {
      return { text: this.paragraph(block.paragraph), paragraphIds: [block.paragraph.id] };
    }
    const paragraphIds: string[] = [];
    return { text: this.table(block.table, paragraphIds), paragraphIds };
  }

  private paragraph(paragraph: DocxParagraph): string {
    const indent = paragraph.list ? "  ".repeat(paragraph.list.level) : "";
    const bullet = paragraph.list ? (paragraph.list.ordered ? "1. " : "- ") : "";
    const lines = [`[${paragraph.id}] ${indent}${bullet}${paragraph.text}`.trimEnd()];
    for (const imageId of paragraph.imageIds) lines.push(this.image(imageId));
    for (const commentId of paragraph.commentIds) {
      const comment = this.comments.get(commentId);
      if (comment) lines.push(this.comment(comment));
    }
    return lines.join("\n");
  }

  private table(table: DocxTable, paragraphIds: string[]): string {
    const notes: string[] = [];
    const rows = table.rows.map((row) => {
      const cells = row.cells.map((cell) =>
        this.cellText(cell.blocks, paragraphIds, notes).replace(/\|/g, "\\|")
      );
      return `| ${cells.join(" | ")} |`;
    });
    return [`[${table.id}] Table:`, ...rows, ...notes].join("\n");
  }

  private cellText(blocks: readonly DocxBlock[], paragraphIds: string[], notes: string[]): string {
    return blocks
      .map((block) => {
        if (block.kind === "table") {
          return block.table.rows
            .map((row) =>
              row.cells.map((cell) => this.cellText(cell.blocks, paragraphIds, notes)).join("; ")
            )
            .join(" / ");
        }
        const { paragraph } = block;
        paragraphIds.push(paragraph.id);
        for (const imageId of paragraph.imageIds) notes.push(this.image(imageId));
        for (const commentId of paragraph.commentIds) {
          const comment = this.comments.get(commentId);
          if (comment) notes.push(this.comment(comment));
        }
        return `[${paragraph.id}] ${paragraph.text.replace(/\n/g, " ")}`;
      })
      .join(" ");
  }

  private image(imageId: string): string {
    const altText = this.images.get(imageId)?.altText;
    return altText ? `  [image ${imageId}: ${altText}]` : `  [image ${imageId}]`;
  }

  private comment(comment: DocxComment): string {
    const on = comment.anchorText ? ` on "${comment.anchorText.replace(/\n/g, " ")}"` : "";
    return `  [existing comment ${comment.id} by ${comment.author}${on}]: ${comment.text}`;
  }
}
