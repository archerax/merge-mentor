/**
 * PRD / FRD review engine (`merge-mentor prd`).
 *
 * Pipeline: read and validate the `.docx` → parse into the document model →
 * split into model-sized chunks → one section pass per chunk → one
 * whole-document consistency pass over the section summaries → verifier
 * (quote check + AI double-check) → Markdown + JSON report.
 *
 * Every artefact of a run (report, source copy, extracted data) is written
 * under the temp path using the layout in `@merge-mentor/shared/reports`
 * (`prdRunPaths`), so `deletePrdRun` removes the whole run.
 *
 * The document is untrusted input. Prompts wrap it in the security preamble
 * defences, and the AI client passed in must be created without write or
 * shell tools (the provider defaults).
 */
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

import { MergeMentorError, ValidationError } from "@merge-mentor/shared/errors/index.js";
import { createChildLogger } from "@merge-mentor/shared/logger.js";
import {
  type Clock,
  consoleOutputWriter,
  type FileSystem,
  nodeFs,
  type OutputWriter,
  systemClock,
} from "@merge-mentor/shared/ports/index.js";
import { type PrdRunPaths, prdRunPaths } from "@merge-mentor/shared/reports/index.js";
import { mergeTokenUsage } from "@merge-mentor/shared/utils/tokenUsage.js";

import packageJson from "../../../package.json" with { type: "json" };
import {
  buildPrdConsistencyPrompt,
  buildPrdSectionPrompt,
  PRD_RUBRICS,
  type PrdDocumentType,
} from "../../ai/prompts/prd.js";
import { PrdConsistencyResultSchema, PrdSectionResultSchema } from "../../ai/schemas.js";
import type { AIProviderClient, AIProviderType, TokenUsage } from "../../ai/types.js";
import { runWithConcurrency } from "../batching.js";
import type { ProgressStatus, ReviewPhaseId, ReviewProgressCallback } from "../progress.js";
import { parseAIJson } from "./aiJson.js";
import { parseDocx, readDocxFile } from "./docxParser.js";
import type { DocxValidationOptions } from "./docxValidator.js";
import {
  fallbackReadinessSummary,
  type PrdReadinessVerdict,
  type PrdReviewReport,
  readinessFromCounts,
  renderPrdReportMarkdown,
} from "./prdReport.js";
import { PrdVerifier } from "./prdVerifier.js";
import { type ChunkOptions, chunkDocument } from "./sectionChunker.js";
import type {
  DocumentChunk,
  DocxDocument,
  PrdCandidateFinding,
  PrdFinding,
  PrdNotReviewedItem,
  PrdSeverity,
} from "./types.js";

export type { PrdReviewReport } from "./prdReport.js";

/** The document to review: a file on disk, or bytes already in memory (an upload). */
export type PrdReviewSource =
  | { readonly path: string }
  | { readonly buffer: Buffer; readonly fileName: string };

/** Options for {@link runPrdReview}. */
export interface PrdReviewOptions {
  readonly source: PrdReviewSource;
  /** Which rubric to apply. */
  readonly documentType: PrdDocumentType;
  /**
   * Review embedded images (`--include-images`). Image review is not
   * implemented yet; images are always listed as not reviewed.
   */
  readonly includeImages?: boolean;
  /** Base directory for reports and run data (default `./.mergementor`). */
  readonly tempPath?: string;
  /** AI provider name, recorded in the report and shown in progress output. */
  readonly aiProvider?: AIProviderType;
  /** Model identifier, recorded in the report. */
  readonly aiModel?: string;
  /** Maximum parallel section passes (default 3; 1 while streaming). */
  readonly concurrency?: number;
  /** Maximum chunks reviewed; the rest are listed as not reviewed (default 80). */
  readonly maxChunks?: number;
  /** Overrides for the section chunker. */
  readonly chunkOptions?: ChunkOptions;
  /** Overrides for the `.docx` size and zip guards. */
  readonly validation?: DocxValidationOptions;
  /** Run id to use instead of a generated one (letters, digits, `-`, `_`). */
  readonly runId?: string;
  /** Output writer for progress messages (default: consoleOutputWriter). */
  readonly output?: OutputWriter;
  /** Raw AI output chunks as they stream in (enables streaming). */
  readonly onStreamChunk?: (chunk: string) => void;
  /** Structured progress events (phases, per-section steps, AI stream deltas). */
  readonly onProgress?: ReviewProgressCallback;
}

/** Filesystem capabilities the engine uses (satisfied by `nodeFs`). */
type PrdReviewFileSystem = Pick<
  FileSystem,
  "stat" | "readFileBuffer" | "mkdir" | "writeFile" | "writeFileBuffer" | "rm"
>;

/** Collaborators for {@link runPrdReview}. */
export interface PrdReviewDeps {
  /**
   * AI client for every pass. Create it without write or shell tools: the
   * prompts contain untrusted document text.
   */
  readonly aiClient: AIProviderClient;
  readonly fileSystem?: PrdReviewFileSystem;
  readonly clock?: Clock;
}

/** A completed review. */
export interface PrdReviewResult {
  readonly runId: string;
  readonly report: PrdReviewReport;
  readonly reportMarkdown: string;
  /** Where the run's files were written. */
  readonly paths: PrdRunPaths;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_CHUNKS = 80;
const SEVERITY_RANK: Record<PrdSeverity, number> = { Blocker: 0, Major: 1, Minor: 2 };

interface SectionPassSuccess {
  readonly ok: true;
  readonly chunk: DocumentChunk;
  readonly summary: string;
  readonly keyStatements: readonly string[];
  readonly candidates: readonly PrdCandidateFinding[];
}

interface SectionPassFailure {
  readonly ok: false;
  readonly chunk: DocumentChunk;
  readonly error: Error;
}

type SectionPassResult = SectionPassSuccess | SectionPassFailure;

/**
 * Reviews a PRD or FRD `.docx` and writes the Markdown and JSON reports.
 *
 * @throws {ValidationError} for an unsafe run id, a file over the size cap, a
 *   file that is not a `.docx`, or a document with no text
 * @throws {DocumentParseError} when the file cannot be read or parsed
 * @throws {MergeMentorError} when every section pass failed
 */
export async function runPrdReview(
  options: PrdReviewOptions,
  deps: PrdReviewDeps
): Promise<PrdReviewResult> {
  return new PrdReviewRun(options, deps).run();
}

/** One execution of the pipeline; holds per-run state. */
class PrdReviewRun {
  private readonly logger = createChildLogger({ component: "PrdReviewEngine" });
  private readonly output: OutputWriter;
  private readonly fs: PrdReviewFileSystem;
  private readonly clock: Clock;
  private readonly ai: AIProviderClient;
  private readonly streaming: boolean;
  private tokenUsage: TokenUsage | undefined;

  constructor(
    private readonly options: PrdReviewOptions,
    deps: PrdReviewDeps
  ) {
    this.output = options.output ?? consoleOutputWriter;
    this.fs = deps.fileSystem ?? nodeFs;
    this.clock = deps.clock ?? systemClock;
    this.ai = deps.aiClient;
    this.streaming = options.onStreamChunk !== undefined || options.onProgress !== undefined;
  }

  async run(): Promise<PrdReviewResult> {
    const { options } = this;
    const createdAt = this.clock.now();
    const fileName = sourceFileName(options.source);
    const runId = options.runId ?? createRunId(createdAt, fileName);
    const paths = prdRunPaths(options.tempPath ?? "./.mergementor", runId);
    const rubric = PRD_RUBRICS[options.documentType];

    this.output.log(`\n🔍 Reviewing ${fileName} as a ${rubric.label}...\n`);

    const buffer = await this.runPhase("resolve", "Reading document", () => this.loadSource());

    const { document, chunks } = await this.runPhase("fetch", "Parsing document", async () => {
      const parsed = await parseDocx(buffer, { validation: options.validation });
      const split = chunkDocument(parsed, options.chunkOptions);
      if (split.length === 0) {
        throw new ValidationError("docx", "the document has no text to review");
      }
      return { document: parsed, chunks: split };
    });

    try {
      await this.fs.mkdir(paths.runDir, { recursive: true });
      await this.fs.writeFileBuffer(paths.sourceDocx, buffer);
      await this.fs.writeFile(
        paths.documentJson,
        JSON.stringify({ document, chunks }, null, 2),
        "utf-8"
      );
      return await this.review({ createdAt, fileName, runId, paths, buffer, document, chunks });
    } catch (error) {
      // Do not leave a copy of a confidential document behind for a failed run.
      await this.fs.rm(paths.runDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async review(run: {
    readonly createdAt: Date;
    readonly fileName: string;
    readonly runId: string;
    readonly paths: PrdRunPaths;
    readonly buffer: Buffer;
    readonly document: DocxDocument;
    readonly chunks: readonly DocumentChunk[];
  }): Promise<PrdReviewResult> {
    const { options } = this;
    const { createdAt, fileName, runId, paths, buffer, document, chunks } = run;
    const maxChunks = Math.max(1, options.maxChunks ?? DEFAULT_MAX_CHUNKS);
    const reviewChunks = chunks.slice(0, maxChunks);
    const skippedChunks = chunks.slice(maxChunks);
    this.output.log(
      `📋 ${document.sections.length} section(s) in ${chunks.length} part(s); reviewing ${reviewChunks.length} with ${options.aiProvider ?? "the configured AI provider"}...\n`
    );

    const sectionResults = await this.runPhase(
      "ai-review",
      `Reviewing ${reviewChunks.length} part(s) of the document`,
      () => this.reviewSections(document, reviewChunks)
    );
    const succeeded = sectionResults.filter((result): result is SectionPassSuccess => result.ok);
    const failed = sectionResults.filter((result): result is SectionPassFailure => !result.ok);
    const sectionCandidates = succeeded.flatMap((result) => result.candidates);

    const consistency = await this.runPhase(
      "consistency",
      "Checking the whole document",
      async () => this.consistencyPass(document, succeeded, sectionCandidates)
    );

    const imageReview = this.reviewImages(document);
    const candidates = [
      ...sectionCandidates,
      ...(consistency?.candidates ?? []),
      ...imageReview.candidates,
    ];

    const verification = await this.runPhase("verify", "Double-checking findings", () =>
      new PrdVerifier(this.ai, {
        documentType: options.documentType,
        onTokenUsage: (usage) => this.addUsage(usage),
        ...(this.streaming ? { onStreamData: this.stream("verify") } : {}),
      }).verify(document, candidates)
    );

    const findings = orderFindings(verification.findings, document);
    const counts = countBySeverity(findings);
    const notReviewed: PrdNotReviewedItem[] = [
      ...failed.map((result) => ({
        kind: "failed-section" as const,
        description: `${chunkLabel(result.chunk, chunks.length)}: could not be reviewed because the AI request failed.`,
        sectionIds: result.chunk.sectionIds,
      })),
      ...skippedChunks.map((chunk) => ({
        kind: "skipped-section" as const,
        description: `${chunkLabel(chunk, chunks.length)}: not reviewed because the document is longer than the review limit of ${maxChunks} parts.`,
        sectionIds: chunk.sectionIds,
      })),
      ...(consistency
        ? []
        : [
            {
              kind: "consistency-check" as const,
              description:
                "The whole-document check (contradictions between sections, missing parts) could not run.",
            },
          ]),
      ...imageReview.notReviewed,
      ...document.warnings.map((warning) => ({
        kind: "parser-warning" as const,
        description: `Some content could not be read: ${warning}`,
      })),
    ];
    const complete = failed.length === 0 && skippedChunks.length === 0 && consistency !== undefined;

    const report: PrdReviewReport = {
      schemaVersion: 1,
      kind: "prd",
      runId,
      createdAt: createdAt.toISOString(),
      documentType: options.documentType,
      source: {
        fileName,
        sizeBytes: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
      },
      document: {
        ...(document.title ? { title: document.title } : {}),
        sectionCount: document.sections.filter((section) => section.level > 0).length,
        chunkCount: chunks.length,
        reviewedChunkCount: succeeded.length,
        hasHeadings: document.hasHeadings,
        imageCount: document.images.length,
        commentCount: document.comments.length,
      },
      readiness: {
        verdict: readinessFromCounts(counts),
        summary: consistency?.summary || fallbackReadinessSummary(counts),
        ...(consistency ? { modelVerdict: consistency.verdict } : {}),
      },
      complete,
      counts,
      findings,
      notReviewed,
      verification: verification.stats,
      includeImages: options.includeImages ?? false,
      ...(options.aiProvider ? { aiProvider: options.aiProvider } : {}),
      ...(options.aiModel ? { aiModel: options.aiModel } : {}),
      ...(this.tokenUsage ? { tokenUsage: this.tokenUsage } : {}),
      version: packageJson.version,
    };

    const reportMarkdown = await this.runPhase("report", "Saving report", async () => {
      const markdown = renderPrdReportMarkdown(report);
      await this.fs.mkdir(path.dirname(paths.reportMarkdown), { recursive: true });
      await this.fs.writeFile(paths.reportMarkdown, markdown, "utf-8");
      await this.fs.writeFile(paths.reportJson, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
      this.output.log(`📄 Report saved to: ${paths.reportMarkdown}\n`);
      return markdown;
    });

    this.displaySummary(report);
    return { runId, report, reportMarkdown, paths };
  }

  // -------------------------------------------------------------------------
  // Passes
  // -------------------------------------------------------------------------

  private async loadSource(): Promise<Buffer> {
    const { source, validation } = this.options;
    if ("buffer" in source) return source.buffer;
    return readDocxFile(source.path, this.fs, { validation });
  }

  private async reviewSections(
    document: DocxDocument,
    chunks: readonly DocumentChunk[]
  ): Promise<SectionPassResult[]> {
    const concurrency = this.streaming
      ? 1
      : Math.max(1, this.options.concurrency ?? DEFAULT_CONCURRENCY);
    const results = await runWithConcurrency(chunks, concurrency, (chunk, index) =>
      this.reviewSection(document, chunk, index, chunks.length)
    );
    if (results.length > 0 && results.every((result) => !result.ok)) {
      const firstError = results.find((result): result is SectionPassFailure => !result.ok)?.error;
      throw new MergeMentorError(
        `None of the ${results.length} part(s) of the document could be reviewed${firstError ? `: ${firstError.message}` : ""}`,
        { cause: firstError }
      );
    }
    return results;
  }

  private async reviewSection(
    document: DocxDocument,
    chunk: DocumentChunk,
    index: number,
    total: number
  ): Promise<SectionPassResult> {
    const label = chunkLabel(chunk, total);
    this.step(label, "start");
    try {
      const prompt = buildPrdSectionPrompt({
        documentType: this.options.documentType,
        documentTitle: document.title,
        chunkText: chunk.text,
        sectionIds: chunk.sectionIds,
        chunkIndex: index + 1,
        chunkCount: total,
        part: chunk.part,
      });
      const response = await this.ai.executePrompt(prompt, {
        promptType: "prd-section",
        ...(this.streaming ? { onStreamData: this.stream("ai-review") } : {}),
      });
      this.addUsage(response.tokenUsage);
      const parsed = PrdSectionResultSchema.safeParse(parseAIJson(response));
      if (!parsed.success) {
        throw new MergeMentorError("the AI response for this section could not be read");
      }
      this.step(label, "done", `${parsed.data.findings.length} possible issue(s)`);
      return {
        ok: true,
        chunk,
        summary: parsed.data.summary,
        keyStatements: parsed.data.keyStatements,
        candidates: this.toCandidates(parsed.data.findings, "section", chunk.sectionIds),
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ chunk: chunk.id, error: err.message }, "PRD section pass failed");
      this.output.log(`⚠️ ${label}: review failed (${err.message})`);
      this.step(label, "error", err.message);
      return { ok: false, chunk, error: err };
    }
  }

  private async consistencyPass(
    document: DocxDocument,
    sections: readonly SectionPassSuccess[],
    sectionCandidates: readonly PrdCandidateFinding[]
  ): Promise<
    { verdict: PrdReadinessVerdict; summary: string; candidates: PrdCandidateFinding[] } | undefined
  > {
    const prompt = buildPrdConsistencyPrompt({
      documentType: this.options.documentType,
      documentTitle: document.title,
      outline: document.sections
        .filter((section) => section.level > 0)
        .map((section) => `${section.id}: ${section.headingPath.join(" > ")}`),
      sections: sections.map((result) => ({
        sectionIds: result.chunk.sectionIds,
        headingPath: result.chunk.headingPath,
        summary: result.summary,
        keyStatements: result.keyStatements,
      })),
      sectionFindings: sectionCandidates.map((candidate) => ({
        severity: candidate.severity,
        sectionId: candidate.sectionId,
        problem: candidate.problem,
      })),
    });
    try {
      const response = await this.ai.executePrompt(prompt, {
        promptType: "prd-consistency",
        ...(this.streaming ? { onStreamData: this.stream("consistency") } : {}),
      });
      this.addUsage(response.tokenUsage);
      const parsed = PrdConsistencyResultSchema.safeParse(parseAIJson(response));
      if (!parsed.success) {
        throw new MergeMentorError(
          "the AI response for the whole-document check could not be read"
        );
      }
      return {
        verdict: parsed.data.readiness.verdict,
        summary: parsed.data.readiness.summary.trim(),
        candidates: this.toCandidates(parsed.data.findings, "consistency", null),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ error: message }, "PRD consistency pass failed");
      this.output.log(`⚠️ Whole-document check failed (${message})`);
      return undefined;
    }
  }

  /**
   * Extension point for image review (`--include-images`, Phase 5). Until it
   * is implemented every image is listed as not reviewed and no findings are
   * produced; an implementation returns its candidates here so they go
   * through the same verifier and report.
   */
  private reviewImages(document: DocxDocument): {
    candidates: PrdCandidateFinding[];
    notReviewed: PrdNotReviewedItem[];
  } {
    const reason = this.options.includeImages
      ? "image review is not available yet"
      : "images are not reviewed unless image review is turned on";
    const headings = new Map(document.sections.map((s) => [s.id, s.headingPath.join(" › ")]));
    const notReviewed = document.images.map((image) => {
      const where = headings.get(image.sectionId);
      const alt = image.altText ? ` (“${image.altText}”)` : "";
      return {
        kind: "image" as const,
        description: `Image ${image.id}${alt}${where ? ` in “${where}”` : ""}: ${reason}.`,
        sectionIds: [image.sectionId],
      };
    });
    return { candidates: [], notReviewed };
  }

  private toCandidates(
    findings: readonly {
      severity: PrdSeverity;
      dimension: string;
      sectionId: string;
      quote: string;
      problem: string;
      suggestion: string;
      authorQuestion?: string;
    }[],
    origin: PrdCandidateFinding["origin"],
    scopeSectionIds: readonly string[] | null
  ): PrdCandidateFinding[] {
    const known = new Set(
      PRD_RUBRICS[this.options.documentType].dimensions.map((dimension) => dimension.id)
    );
    return findings
      .filter((finding) => finding.problem.trim().length > 0)
      .map((finding) => ({
        severity: finding.severity,
        dimension: known.has(finding.dimension.trim()) ? finding.dimension.trim() : "general",
        sectionId: finding.sectionId.trim().replace(/^\[|\]$/g, ""),
        quote: finding.quote,
        problem: finding.problem,
        suggestion: finding.suggestion,
        ...(finding.authorQuestion ? { authorQuestion: finding.authorQuestion } : {}),
        origin,
        scopeSectionIds,
      }));
  }

  // -------------------------------------------------------------------------
  // Progress and output
  // -------------------------------------------------------------------------

  private async runPhase<T>(id: ReviewPhaseId, label: string, fn: () => Promise<T>): Promise<T> {
    this.phase(id, label, "start");
    try {
      const value = await fn();
      this.phase(id, label, "done");
      return value;
    } catch (error) {
      this.phase(id, label, "error");
      throw error;
    }
  }

  private phase(id: ReviewPhaseId, label: string, status: ProgressStatus): void {
    this.options.onProgress?.({ kind: "phase", id, label, status });
  }

  private step(label: string, status: ProgressStatus, detail?: string): void {
    this.options.onProgress?.({
      kind: "step",
      label,
      status,
      ...(detail !== undefined ? { detail } : {}),
    });
  }

  private stream(phase: ReviewPhaseId): (chunk: string) => void {
    return (chunk) => {
      this.options.onStreamChunk?.(chunk);
      this.options.onProgress?.({ kind: "stream", phase, delta: chunk });
    };
  }

  private addUsage(usage: TokenUsage | undefined): void {
    this.tokenUsage = mergeTokenUsage(this.tokenUsage, usage);
  }

  private displaySummary(report: PrdReviewReport): void {
    const { counts } = report;
    this.output.log("=".repeat(60));
    this.output.log(`📊 ${report.documentType.toUpperCase()} review: ${report.readiness.verdict}`);
    this.output.log("=".repeat(60));
    this.output.log(report.readiness.summary);
    this.output.log(
      `\nBlockers: ${counts.Blocker} · Major: ${counts.Major} · Minor: ${counts.Minor} · Not reviewed: ${report.notReviewed.length}`
    );
    this.output.log(`${"=".repeat(60)}\n`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sourceFileName(source: PrdReviewSource): string {
  const name = path.basename("path" in source ? source.path : source.fileName);
  return name.length > 0 ? name : "document.docx";
}

/** `20261023-142530-checkout-prd-a1b2c3`: sortable, readable and unique. */
function createRunId(date: Date, fileName: string): string {
  const stamp = date
    .toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replace(/[-:]/g, "")
    .replace("T", "-");
  const slug =
    fileName
      .replace(/\.docx$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "document";
  return `${stamp}-${slug}-${randomBytes(3).toString("hex")}`;
}

function chunkLabel(chunk: DocumentChunk, total: number): string {
  const number = Number.parseInt(chunk.id.slice(1), 10);
  const base =
    chunk.headingPath.length > 0
      ? `“${chunk.headingPath.join(" › ")}”`
      : `Document text, part ${number} of ${total}`;
  return chunk.part && chunk.headingPath.length > 0
    ? `${base} (part ${chunk.part.index} of ${chunk.part.total})`
    : base;
}

function paragraphNumber(id: string | undefined): number {
  const value = id ? Number.parseInt(id.slice(1), 10) : Number.NaN;
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}

function orderFindings(
  findings: readonly Omit<PrdFinding, "id">[],
  document: DocxDocument
): PrdFinding[] {
  const position = new Map(document.sections.map((section, index) => [section.id, index]));
  return findings
    .toSorted(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        (position.get(a.sectionId) ?? 0) - (position.get(b.sectionId) ?? 0) ||
        paragraphNumber(a.paragraphId) - paragraphNumber(b.paragraphId)
    )
    .map((finding, index) => ({ id: `f${index + 1}`, ...finding }));
}

function countBySeverity(findings: readonly PrdFinding[]): Record<PrdSeverity, number> {
  const counts: Record<PrdSeverity, number> = { Blocker: 0, Major: 0, Minor: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}
