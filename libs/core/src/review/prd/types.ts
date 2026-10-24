/**
 * Structured document model for PRD / FRD review.
 *
 * A `.docx` file is parsed into a {@link DocxDocument}: a flat, document-ordered
 * list of sections (the heading tree, linked by `parentId` / `childIds`), each
 * holding paragraphs and tables, plus the document's existing comments and an
 * image list. The model reflects the *accepted* view of tracked changes:
 * insertions are kept and deletions dropped.
 *
 * Ids are deterministic for a given document, so findings, reports and the
 * verifier can refer to them:
 * - sections: `s0` (content before the first heading), `s1`, `s1.2`, `s1.2.1`, ...
 *   numbered by position in the heading tree
 * - paragraphs: `p1`, `p2`, ... in document order (including table cells)
 * - tables: `t1`, `t2`, ...
 * - images: `img1`, `img2`, ...
 * - comments keep the id Word assigned (`w:id`)
 */

/** List membership of a paragraph (numbered or bulleted). */
interface DocxListInfo {
  /** Zero-based nesting level. */
  readonly level: number;
  readonly ordered: boolean;
}

/** A paragraph of text (accepted view of tracked changes). */
export interface DocxParagraph {
  readonly id: string;
  readonly text: string;
  /** Word style name (e.g. "heading 2", "List Paragraph"), when set. */
  readonly styleName?: string;
  readonly list?: DocxListInfo;
  /** Ids of existing comments anchored to this paragraph. */
  readonly commentIds: readonly string[];
  /** Ids of images embedded in this paragraph. */
  readonly imageIds: readonly string[];
}

/** One table cell; cells may contain paragraphs and nested tables. */
export interface DocxTableCell {
  readonly blocks: readonly DocxBlock[];
  readonly colSpan: number;
  readonly rowSpan: number;
}

export interface DocxTableRow {
  readonly cells: readonly DocxTableCell[];
  /** True when the row is marked as a repeating header row in Word. */
  readonly isHeader: boolean;
}

/** A table, e.g. an FRD requirement matrix. */
export interface DocxTable {
  readonly id: string;
  readonly rows: readonly DocxTableRow[];
}

/** Body content of a section, in document order. */
export type DocxBlock =
  | { readonly kind: "paragraph"; readonly paragraph: DocxParagraph }
  | { readonly kind: "table"; readonly table: DocxTable };

/** A node of the heading tree with its own (non-descendant) content. */
export interface DocxSection {
  readonly id: string;
  /** Heading text; empty for the preamble section `s0`. */
  readonly title: string;
  /** Word heading level (1-9); 0 for the preamble. */
  readonly level: number;
  /** Titles from the top-level ancestor down to this section. */
  readonly headingPath: readonly string[];
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  /** Paragraph id of the heading itself; null for the preamble. */
  readonly headingParagraphId: string | null;
  readonly blocks: readonly DocxBlock[];
}

/** An existing Word comment, attached to its anchor paragraph. */
export interface DocxComment {
  readonly id: string;
  readonly author: string;
  readonly initials?: string;
  readonly text: string;
  /** The commented text (between `commentRangeStart` and `commentRangeEnd`), if any. */
  readonly anchorText?: string;
  /** Paragraph the comment is anchored to; null if it could not be located. */
  readonly paragraphId: string | null;
  readonly sectionId: string | null;
}

/** An embedded image (not reviewed unless `--include-images` is on). */
export interface DocxImage {
  readonly id: string;
  readonly paragraphId: string;
  readonly sectionId: string;
  readonly contentType: string;
  readonly altText?: string;
  /** Zip part path (e.g. `word/media/image1.png`) for later extraction. */
  readonly partPath?: string;
  /** Size in bytes; absent when the image data could not be read. */
  readonly sizeBytes?: number;
  /** Hex SHA-256 of the image bytes; absent when the image data could not be read. */
  readonly sha256?: string;
}

/** The parsed document. */
export interface DocxDocument {
  /** Text of the first paragraph styled "Title", if any. */
  readonly title?: string;
  /** All sections in document order; the first is the root of its tree. */
  readonly sections: readonly DocxSection[];
  readonly comments: readonly DocxComment[];
  readonly images: readonly DocxImage[];
  /** False when no heading-styled paragraphs were found (fallback chunking applies). */
  readonly hasHeadings: boolean;
  /** Non-fatal conversion warnings (e.g. unsupported content). */
  readonly warnings: readonly string[];
}

/** A unit of document text sized to fit one model call. */
export interface DocumentChunk {
  /** `c1`, `c2`, ... in document order. */
  readonly id: string;
  /** Sections whose content is (fully or partly) in this chunk. */
  readonly sectionIds: readonly string[];
  /** Heading path of the first section in the chunk (empty for headingless documents). */
  readonly headingPath: readonly string[];
  /** Rendered text sent to the model; paragraphs are prefixed with their ids. */
  readonly text: string;
  /** Paragraph ids rendered in this chunk (including overlap). */
  readonly paragraphIds: readonly string[];
  /** Set when one section had to be split across several chunks. */
  readonly part?: { readonly index: number; readonly total: number };
}

// ---------------------------------------------------------------------------
// Review results
// ---------------------------------------------------------------------------

/** Severity of a review finding. */
export type PrdSeverity = "Blocker" | "Major" | "Minor";

/** Which pass produced a finding. */
type PrdFindingOrigin = "section" | "consistency" | "image";

/** A finding proposed by a section or consistency pass, before verification. */
export interface PrdCandidateFinding {
  readonly severity: PrdSeverity;
  /** Rubric dimension id, or `"general"` when the model gave an unknown one. */
  readonly dimension: string;
  readonly sectionId: string;
  /** Text the model says it copied from the document (may be empty for image findings). */
  readonly quote: string;
  readonly problem: string;
  readonly suggestion: string;
  readonly authorQuestion?: string;
  readonly origin: PrdFindingOrigin;
  /**
   * Sections the quote may come from (the reviewed chunk's sections), or null
   * to search the whole document (consistency findings).
   */
  readonly scopeSectionIds: readonly string[] | null;
  /**
   * Set for image-pass findings: the image the finding is about. These are
   * grounded by the image id and its section rather than by the quote, which
   * may be empty or the image's alt text.
   */
  readonly imageId?: string;
}

/** A verified finding as it appears in the report. */
export interface PrdFinding {
  /** `f1`, `f2`, ... in report order. */
  readonly id: string;
  readonly severity: PrdSeverity;
  readonly dimension: string;
  /** Human-readable dimension name from the rubric. */
  readonly dimensionName: string;
  /** Section the quote was found in (may differ from the one the model cited). */
  readonly sectionId: string;
  readonly headingPath: readonly string[];
  /** Paragraph where the quote starts. */
  readonly paragraphId?: string;
  readonly quote: string;
  readonly problem: string;
  readonly suggestion: string;
  readonly authorQuestion?: string;
  readonly origin: PrdFindingOrigin;
  /** Image the finding is about (image-pass findings only). */
  readonly imageId?: string;
  /** Alt text of that image, when it has one. */
  readonly imageAltText?: string;
}

/** Why part of the document was not reviewed. */
type PrdNotReviewedKind =
  | "image"
  | "failed-section"
  | "skipped-section"
  | "consistency-check"
  | "parser-warning";

/** Something the review did not cover, listed in the report. */
export interface PrdNotReviewedItem {
  readonly kind: PrdNotReviewedKind;
  readonly description: string;
  readonly sectionIds?: readonly string[];
}

/** Counts recorded by the verifier. */
export interface PrdVerificationStats {
  /** Candidates handed to the verifier. */
  readonly candidates: number;
  /** Dropped because the quote was not found in the document text. */
  readonly droppedUnsupportedQuote: number;
  /** Dropped as an exact duplicate of another candidate. */
  readonly droppedDuplicate: number;
  /** Dropped by the AI verifier pass. */
  readonly droppedByVerifier: number;
  /** Findings kept. */
  readonly kept: number;
  /** True when (part of) the AI verifier pass failed and its findings were kept unchecked. */
  readonly verifierFailed: boolean;
}
