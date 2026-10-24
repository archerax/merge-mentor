/**
 * Verifies PRD / FRD review findings before they reach the report.
 *
 * Two stages, mirroring the idea of `pbiVerifier.ts` (an AI check of model
 * output against the source material):
 * 1. **Deterministic quote check.** Every finding must quote the document. The
 *    quote is searched (whitespace-, quote-mark- and case-insensitively) in the
 *    text of the cited section and its subsections, then in the other sections
 *    of the reviewed chunk; consistency findings may quote any section. A
 *    finding whose quote cannot be found is dropped. Exact duplicates (same
 *    quote and dimension) are collapsed. Image findings are grounded by their
 *    image id instead: the image must exist, the finding is attributed to the
 *    image's section, and a quote that is neither found near the image nor
 *    the image's alt text is cleared rather than causing a drop.
 * 2. **AI verifier pass.** The remaining findings, each with the document text
 *    around its quote, go to the model in batches; findings it rejects as
 *    unsupported, misread or duplicate are dropped. If a verifier call fails,
 *    that batch is kept unchecked and the failure is recorded.
 */
import { createChildLogger } from "@merge-mentor/shared/logger.js";

import {
  buildPrdVerifierPrompt,
  PRD_RUBRICS,
  type PrdDocumentType,
  type PrdVerifierCandidate,
} from "../../ai/prompts/prd.js";
import { PrdVerifierResultSchema } from "../../ai/schemas.js";
import type { AIProviderClient, TokenUsage } from "../../ai/types.js";
import { parseAIJson } from "./aiJson.js";
import type {
  DocxBlock,
  DocxDocument,
  DocxImage,
  DocxSection,
  PrdCandidateFinding,
  PrdFinding,
  PrdSeverity,
  PrdVerificationStats,
} from "./types.js";

/** A verified finding before report ids are assigned. */
export type VerifiedPrdFinding = Omit<PrdFinding, "id">;

/** Options for {@link PrdVerifier}. */
export interface PrdVerifierOptions {
  readonly documentType: PrdDocumentType;
  /** Run the AI verifier pass after the quote check (default true). */
  readonly aiVerification?: boolean;
  /** Maximum candidates per AI verifier call (default 20). */
  readonly batchSize?: number;
  /** Called with the token usage of each AI verifier call. */
  readonly onTokenUsage?: (usage: TokenUsage | undefined) => void;
  /** Called with raw AI output chunks; enables streaming when set. */
  readonly onStreamData?: (chunk: string) => void;
  /** Directory for the AI transcripts of the verifier calls (see `ExecutePromptOptions`). */
  readonly transcriptDir?: string;
  /** Called when the provider could not delete a verifier call's session data. */
  readonly onSessionDiscardFailed?: (reason: string) => void;
}

/** Outcome of {@link PrdVerifier.verify}. */
export interface PrdVerificationResult {
  readonly findings: VerifiedPrdFinding[];
  readonly stats: PrdVerificationStats;
}

const DEFAULT_BATCH_SIZE = 20;
/** Maximum characters of document context sent with each candidate. */
const MAX_CONTEXT_CHARS = 1_500;
/** Quotes shorter than this (after normalisation) are too weak to locate anything. */
const MIN_QUOTE_CHARS = 3;

const SEVERITY_RANK: Record<PrdSeverity, number> = { Blocker: 0, Major: 1, Minor: 2 };

/**
 * Normalises text for quote matching: Unicode compatibility forms, curly
 * quotes and dashes to ASCII, invisible characters removed, whitespace
 * collapsed and lower-cased.
 */
export function normaliseForQuoteMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[​-‍⁠﻿­]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Splits a model-supplied quote into normalised segments to search for, in
 * order. Id markers (`[p12]`, `[s2.1]`, `[t1]`) and wrapping quote marks are
 * removed, and an ellipsis separates segments.
 */
function quoteSegments(quote: string): string[] {
  const cleaned = normaliseForQuoteMatch(quote)
    .replace(/\[(?:p\d+|s[\d.]+|t\d+|img\d+|c\d+)\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
  return cleaned
    .split("...")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

interface IndexedParagraph {
  readonly id: string;
  readonly text: string;
}

interface IndexedSection {
  readonly section: DocxSection;
  readonly paragraphs: readonly IndexedParagraph[];
  /** Normalised paragraph texts joined by single spaces. */
  readonly joined: string;
  /** Start offset of each paragraph within `joined`. */
  readonly offsets: readonly number[];
}

/** Where a quote was found. */
interface QuoteLocation {
  readonly sectionId: string;
  readonly paragraphId?: string;
}

/** Searchable text of every section of a document, for locating quotes. */
export class DocumentTextIndex {
  private readonly sections = new Map<string, IndexedSection>();
  private readonly images: ReadonlyMap<string, DocxImage>;
  private readonly order: readonly string[];

  constructor(document: DocxDocument) {
    this.order = document.sections.map((section) => section.id);
    this.images = new Map(document.images.map((image) => [image.id, image]));
    for (const section of document.sections) {
      const paragraphs: IndexedParagraph[] = [];
      if (section.headingParagraphId) {
        paragraphs.push({ id: section.headingParagraphId, text: section.title });
      }
      collectParagraphs(section.blocks, paragraphs);
      const offsets: number[] = [];
      let joined = "";
      for (const paragraph of paragraphs) {
        const text = normaliseForQuoteMatch(paragraph.text);
        if (joined.length > 0) joined += " ";
        offsets.push(joined.length);
        joined += text;
      }
      this.sections.set(section.id, { section, paragraphs, joined, offsets });
    }
  }

  /** The image with this id, if the document has one. */
  image(imageId: string): DocxImage | undefined {
    return this.images.get(imageId);
  }

  /** True when the document has a section with this id. */
  has(sectionId: string): boolean {
    return this.sections.has(sectionId);
  }

  /** Heading path of a section (empty when unknown). */
  headingPath(sectionId: string): readonly string[] {
    return this.sections.get(sectionId)?.section.headingPath ?? [];
  }

  /** The section and its descendants, in document order. */
  subtree(sectionId: string): string[] {
    const entry = this.sections.get(sectionId);
    if (!entry) return [];
    return [sectionId, ...entry.section.childIds.flatMap((id) => this.subtree(id))];
  }

  /**
   * Finds `quote` in the given sections (in order), or in every section when
   * `sectionIds` is null.
   */
  locate(quote: string, sectionIds: readonly string[] | null): QuoteLocation | undefined {
    const segments = quoteSegments(quote);
    const length = segments.reduce((sum, segment) => sum + segment.length, 0);
    if (length < MIN_QUOTE_CHARS) return undefined;
    for (const sectionId of sectionIds ?? this.order) {
      const entry = this.sections.get(sectionId);
      if (!entry) continue;
      const start = findSegments(entry.joined, segments);
      if (start === undefined) continue;
      return { sectionId, paragraphId: paragraphAt(entry, start) };
    }
    return undefined;
  }

  /**
   * Document text around a paragraph (the paragraph and its neighbours in the
   * same section), rendered with paragraph ids and capped in length.
   */
  context(sectionId: string, paragraphId: string | undefined): string {
    const entry = this.sections.get(sectionId);
    if (!entry) return "";
    const index = Math.max(
      0,
      entry.paragraphs.findIndex((paragraph) => paragraph.id === paragraphId)
    );
    const lines = entry.paragraphs
      .slice(Math.max(0, index - 1), index + 2)
      .map((paragraph) => `[${paragraph.id}] ${paragraph.text}`);
    const heading = entry.section.headingPath.join(" > ");
    const text = [heading ? `Section: ${heading} [${sectionId}]` : `[${sectionId}]`, ...lines].join(
      "\n"
    );
    return text.length > MAX_CONTEXT_CHARS ? `${text.slice(0, MAX_CONTEXT_CHARS)}...` : text;
  }
}

function collectParagraphs(blocks: readonly DocxBlock[], into: IndexedParagraph[]): void {
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      into.push({ id: block.paragraph.id, text: block.paragraph.text });
      continue;
    }
    for (const row of block.table.rows) {
      for (const cell of row.cells) collectParagraphs(cell.blocks, into);
    }
  }
}

/** Returns the offset where the first segment matched, when all segments match in order. */
function findSegments(haystack: string, segments: readonly string[]): number | undefined {
  let cursor = 0;
  let first: number | undefined;
  for (const segment of segments) {
    const index = haystack.indexOf(segment, cursor);
    if (index === -1) return undefined;
    first ??= index;
    cursor = index + segment.length;
  }
  return first;
}

function paragraphAt(entry: IndexedSection, offset: number): string | undefined {
  let found: string | undefined;
  entry.offsets.forEach((start, index) => {
    if (start <= offset) found = entry.paragraphs[index]?.id;
  });
  return found;
}

/** Display name of a dimension id for a document type. */
export function dimensionName(documentType: PrdDocumentType, dimension: string): string {
  return (
    PRD_RUBRICS[documentType].dimensions.find((candidate) => candidate.id === dimension)?.name ??
    "General"
  );
}

/** Result of the deterministic quote check. */
interface QuoteCheckResult {
  readonly findings: VerifiedPrdFinding[];
  readonly droppedUnsupportedQuote: number;
  readonly droppedDuplicate: number;
}

/**
 * Keeps only candidates whose quote is found in the document, re-attributing
 * each to the section where the quote actually is, and collapses exact
 * duplicates (keeping the most severe).
 */
export function checkQuotes(
  index: DocumentTextIndex,
  candidates: readonly PrdCandidateFinding[],
  documentType: PrdDocumentType
): QuoteCheckResult {
  const kept = new Map<string, VerifiedPrdFinding>();
  let droppedUnsupportedQuote = 0;
  let droppedDuplicate = 0;

  for (const candidate of candidates) {
    if (candidate.imageId !== undefined) {
      const finding = groundImageFinding(index, candidate, documentType);
      if (!finding) {
        droppedUnsupportedQuote += 1;
        continue;
      }
      const key = `image\u0000${candidate.imageId}\u0000${candidate.dimension}\u0000${normaliseForQuoteMatch(candidate.problem)}`;
      if (kept.has(key)) {
        droppedDuplicate += 1;
        continue;
      }
      kept.set(key, finding);
      continue;
    }
    const location = locateCandidate(index, candidate);
    if (!location) {
      droppedUnsupportedQuote += 1;
      continue;
    }
    const finding: VerifiedPrdFinding = {
      severity: candidate.severity,
      dimension: candidate.dimension,
      dimensionName: dimensionName(documentType, candidate.dimension),
      sectionId: location.sectionId,
      headingPath: index.headingPath(location.sectionId),
      ...(location.paragraphId ? { paragraphId: location.paragraphId } : {}),
      quote: candidate.quote.trim(),
      problem: candidate.problem.trim(),
      suggestion: candidate.suggestion.trim(),
      ...(candidate.authorQuestion ? { authorQuestion: candidate.authorQuestion.trim() } : {}),
      origin: candidate.origin,
    };
    const key = `${candidate.dimension}\u0000${quoteSegments(candidate.quote).join("...")}`;
    const existing = kept.get(key);
    if (existing) {
      droppedDuplicate += 1;
      if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[existing.severity]) {
        kept.set(key, finding);
      }
      continue;
    }
    kept.set(key, finding);
  }

  return { findings: [...kept.values()], droppedUnsupportedQuote, droppedDuplicate };
}

/**
 * Grounds an image finding by its image id: drops it when the document has no
 * such image, attributes it to the image's section, and keeps the quote only
 * when it is found near the image or is the image's alt text.
 */
function groundImageFinding(
  index: DocumentTextIndex,
  candidate: PrdCandidateFinding,
  documentType: PrdDocumentType
): VerifiedPrdFinding | undefined {
  const image = candidate.imageId ? index.image(candidate.imageId) : undefined;
  if (!image) return undefined;
  const quote = candidate.quote.trim();
  const location =
    quote.length > 0 ? index.locate(quote, index.subtree(image.sectionId)) : undefined;
  const isAltText =
    quote.length > 0 &&
    image.altText !== undefined &&
    normaliseForQuoteMatch(quote).replace(/^["']+|["']+$/g, "") ===
      normaliseForQuoteMatch(image.altText);
  const sectionId = location?.sectionId ?? image.sectionId;
  return {
    severity: candidate.severity,
    dimension: candidate.dimension,
    dimensionName: dimensionName(documentType, candidate.dimension),
    sectionId,
    headingPath: index.headingPath(sectionId),
    paragraphId: location?.paragraphId ?? image.paragraphId,
    quote: location ? quote : isAltText ? (image.altText?.trim() ?? "") : "",
    problem: candidate.problem.trim(),
    suggestion: candidate.suggestion.trim(),
    ...(candidate.authorQuestion ? { authorQuestion: candidate.authorQuestion.trim() } : {}),
    origin: candidate.origin,
    imageId: image.id,
    ...(image.altText ? { imageAltText: image.altText } : {}),
  };
}

function locateCandidate(
  index: DocumentTextIndex,
  candidate: PrdCandidateFinding
): QuoteLocation | undefined {
  if (candidate.quote.trim().length === 0) return undefined;
  if (candidate.scopeSectionIds === null) {
    const cited = index.has(candidate.sectionId) ? index.subtree(candidate.sectionId) : [];
    return (
      (cited.length > 0 ? index.locate(candidate.quote, cited) : undefined) ??
      index.locate(candidate.quote, null)
    );
  }
  const scope = candidate.scopeSectionIds;
  const cited = scope.includes(candidate.sectionId)
    ? index.subtree(candidate.sectionId).filter((id) => scope.includes(id))
    : [];
  return (
    (cited.length > 0 ? index.locate(candidate.quote, cited) : undefined) ??
    index.locate(candidate.quote, scope)
  );
}

/**
 * Runs the quote check and the AI verifier pass over candidate findings.
 */
export class PrdVerifier {
  private readonly logger = createChildLogger({ component: "PrdVerifier" });

  constructor(
    private readonly provider: AIProviderClient,
    private readonly options: PrdVerifierOptions
  ) {}

  /**
   * Verifies candidate findings against the document.
   *
   * @param document - The parsed document the findings refer to
   * @param candidates - Findings from the section and consistency passes
   */
  async verify(
    document: DocxDocument,
    candidates: readonly PrdCandidateFinding[]
  ): Promise<PrdVerificationResult> {
    const index = new DocumentTextIndex(document);
    const checked = checkQuotes(index, candidates, this.options.documentType);

    let findings = checked.findings;
    let droppedByVerifier = 0;
    let verifierFailed = false;
    if ((this.options.aiVerification ?? true) && findings.length > 0) {
      const result = await this.aiVerify(index, findings);
      droppedByVerifier = findings.length - result.findings.length;
      findings = result.findings;
      verifierFailed = result.failed;
    }

    return {
      findings,
      stats: {
        candidates: candidates.length,
        droppedUnsupportedQuote: checked.droppedUnsupportedQuote,
        droppedDuplicate: checked.droppedDuplicate,
        droppedByVerifier,
        kept: findings.length,
        verifierFailed,
      },
    };
  }

  private async aiVerify(
    index: DocumentTextIndex,
    findings: readonly VerifiedPrdFinding[]
  ): Promise<{ findings: VerifiedPrdFinding[]; failed: boolean }> {
    const batchSize = Math.max(1, this.options.batchSize ?? DEFAULT_BATCH_SIZE);
    const kept: VerifiedPrdFinding[] = [];
    let failed = false;

    for (let start = 0; start < findings.length; start += batchSize) {
      const batch = findings.slice(start, start + batchSize);
      const candidates: PrdVerifierCandidate[] = batch.map((finding, offset) => ({
        id: `F${start + offset + 1}`,
        severity: finding.severity,
        dimension: finding.dimensionName,
        sectionId: finding.sectionId,
        quote: finding.quote,
        problem: finding.problem,
        suggestion: finding.suggestion,
        context: index.context(finding.sectionId, finding.paragraphId),
        ...(finding.imageId
          ? {
              image: {
                id: finding.imageId,
                ...(finding.imageAltText ? { altText: finding.imageAltText } : {}),
              },
            }
          : {}),
      }));
      const rejected = await this.rejectedIds(candidates);
      if (rejected === undefined) {
        failed = true;
        kept.push(...batch);
        continue;
      }
      batch.forEach((finding, offset) => {
        if (!rejected.has(candidates[offset]?.id ?? "")) kept.push(finding);
      });
    }

    return { findings: kept, failed };
  }

  /** Ids the verifier rejected, or undefined when the call failed. */
  private async rejectedIds(
    candidates: readonly PrdVerifierCandidate[]
  ): Promise<Set<string> | undefined> {
    const prompt = buildPrdVerifierPrompt({
      documentType: this.options.documentType,
      candidates,
    });
    try {
      const { onStreamData, transcriptDir, onSessionDiscardFailed } = this.options;
      const response = await this.provider.executePrompt(prompt, {
        promptType: "prd-verify",
        discardSession: true,
        ...(onSessionDiscardFailed ? { onSessionDiscardFailed } : {}),
        ...(onStreamData ? { onStreamData } : {}),
        ...(transcriptDir ? { transcriptDir } : {}),
      });
      this.options.onTokenUsage?.(response.tokenUsage);
      const parsed = PrdVerifierResultSchema.safeParse(parseAIJson(response));
      if (!parsed.success) {
        this.logger.warn({ error: parsed.error.message }, "PRD verifier response was not usable");
        return undefined;
      }
      return new Set(parsed.data.verdicts.filter((v) => !v.keep).map((v) => v.id.trim()));
    } catch (error) {
      this.logger.warn({ error: (error as Error).message }, "PRD verifier call failed");
      return undefined;
    }
  }
}
