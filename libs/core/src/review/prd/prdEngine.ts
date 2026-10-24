/**
 * PRD / FRD review engine (`merge-mentor prd`).
 *
 * Pipeline: read and validate the `.docx` → parse into the document model →
 * split into model-sized chunks → one section pass per chunk → one
 * whole-document consistency pass over the section summaries → with
 * `includeImages`, an image pass per document part that has images (when the
 * model accepts images) → verifier (quote check + AI double-check) → Markdown
 * + JSON report.
 *
 * Every artefact of a run (report, source copy, extracted data and images,
 * AI transcripts via the provider's `transcriptDir` option) is written
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
import { deletePrdRun, type PrdRunPaths, prdRunPaths } from "@merge-mentor/shared/reports/index.js";
import { mergeTokenUsage } from "@merge-mentor/shared/utils/tokenUsage.js";

import packageJson from "../../../package.json" with { type: "json" };
import {
  buildPrdConsistencyPrompt,
  buildPrdImagePrompt,
  buildPrdSectionPrompt,
  PRD_RUBRICS,
  type PrdDocumentType,
} from "../../ai/prompts/prd.js";
import {
  PrdConsistencyResultSchema,
  PrdImageResultSchema,
  PrdSectionResultSchema,
} from "../../ai/schemas.js";
import type {
  AIProviderClient,
  AIProviderType,
  ImageInputSupport,
  PromptImageFile,
  TokenUsage,
} from "../../ai/types.js";
import { runWithConcurrency } from "../batching.js";
import type { ProgressStatus, ReviewPhaseId, ReviewProgressCallback } from "../progress.js";
import { parseAIJson } from "./aiJson.js";
import { parseDocx, readDocxFile, readDocxImageData } from "./docxParser.js";
import { type DocxValidationOptions, formatMb } from "./docxValidator.js";
import {
  fallbackReadinessSummary,
  type PrdImageReviewSummary,
  type PrdReadinessVerdict,
  type PrdReviewReport,
  readinessFromCounts,
  renderPrdReportMarkdown,
  verdictLabel,
} from "./prdReport.js";
import { PrdVerifier } from "./prdVerifier.js";
import { type ChunkOptions, chunkDocument } from "./sectionChunker.js";
import type {
  DocumentChunk,
  DocxDocument,
  DocxImage,
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
   * Review embedded images (`--include-images`, default false). Images are
   * sent only when the AI client reports that its model accepts images
   * (`checkImageSupport`); otherwise, and for images over the limits, they
   * are listed as not reviewed.
   */
  readonly includeImages?: boolean;
  /** Overrides for the image review limits. */
  readonly imageLimits?: PrdImageReviewLimits;
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

/** Limits for image review; the provider's own limits apply when lower. */
interface PrdImageReviewLimits {
  /** Most images reviewed per run; the rest are listed as not reviewed (default 20). */
  readonly maxImages?: number;
  /** Largest image reviewed, in bytes (default 5 MB). */
  readonly maxImageBytes?: number;
  /** Most images attached to one AI request (default 4). */
  readonly imagesPerRequest?: number;
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
const DEFAULT_MAX_IMAGES = 20;
const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_IMAGES_PER_REQUEST = 4;
/** Image formats sent when the provider does not list the ones its model accepts. */
const DEFAULT_IMAGE_MEDIA_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "image/svg+xml": ".svg",
};
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
  /** Where the provider writes this run's AI transcripts (inside the run directory). */
  private transcriptDir: string | undefined;
  /** Reasons the provider could not delete session data after a request. */
  private readonly discardFailures: string[] = [];
  private readonly onSessionDiscardFailed = (reason: string): void => {
    this.discardFailures.push(reason);
  };

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
    // Keep transcripts (which contain document text) inside the run directory,
    // so deleting the run removes them too.
    this.transcriptDir = path.resolve(paths.transcriptsDir);
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
      // Do not leave a copy of a confidential document (or a half-written
      // report pair) behind for a failed run.
      await deletePrdRun(runId, {
        tempPath: options.tempPath ?? "./.mergementor",
        fs: this.fs,
      }).catch((cleanupError: unknown) => {
        this.output.error(
          `⚠️ The review failed and its files could not be fully removed (${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}). Delete ${paths.runDir} and the run's reports by hand if the document is confidential.`
        );
      });
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

    const imageReview = await this.reviewImages({ document, chunks, buffer, paths });
    const candidates = [
      ...sectionCandidates,
      ...(consistency?.candidates ?? []),
      ...imageReview.candidates,
    ];

    const verification = await this.runPhase("verify", "Double-checking findings", () =>
      new PrdVerifier(this.ai, {
        documentType: options.documentType,
        onTokenUsage: (usage) => this.addUsage(usage),
        ...(this.transcriptDir ? { transcriptDir: this.transcriptDir } : {}),
        onSessionDiscardFailed: this.onSessionDiscardFailed,
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
    const complete =
      failed.length === 0 &&
      skippedChunks.length === 0 &&
      consistency !== undefined &&
      !imageReview.incomplete &&
      document.warnings.length === 0;

    const verdict = readinessFromCounts(counts, complete);

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
        verdict,
        // The model's summary was written for its own verdict; use it only when
        // that agrees with the verdict derived from the verified findings and
        // the review was complete (a partial review gets the partial summary).
        summary:
          (complete && consistency?.verdict === verdict ? consistency.summary : "") ||
          fallbackReadinessSummary(counts, complete),
        ...(consistency ? { modelVerdict: consistency.verdict } : {}),
      },
      complete,
      counts,
      findings,
      notReviewed,
      verification: verification.stats,
      includeImages: options.includeImages ?? false,
      ...(imageReview.summary ? { imageReview: imageReview.summary } : {}),
      ...(this.discardFailures.length > 0
        ? { retainedSessionData: { count: this.discardFailures.length } }
        : {}),
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
        discardSession: true,
        onSessionDiscardFailed: this.onSessionDiscardFailed,
        ...(this.transcriptDir ? { transcriptDir: this.transcriptDir } : {}),
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
        discardSession: true,
        onSessionDiscardFailed: this.onSessionDiscardFailed,
        ...(this.transcriptDir ? { transcriptDir: this.transcriptDir } : {}),
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
   * Image review (`includeImages`). When the AI model accepts images, the
   * reviewable images are extracted into the run's `images/` directory and
   * reviewed in the context of the document part they appear in (one call
   * per part, in batches of the per-request limit). Every image that is not
   * reviewed is listed with the reason. Image findings go through the same
   * verifier, grounded by image id and section.
   */
  private async reviewImages(run: {
    readonly document: DocxDocument;
    readonly chunks: readonly DocumentChunk[];
    readonly buffer: Buffer;
    readonly paths: PrdRunPaths;
  }): Promise<{
    candidates: PrdCandidateFinding[];
    notReviewed: PrdNotReviewedItem[];
    /**
     * True when image review was requested and an image was left unreviewed
     * (an identical copy whose twin was reviewed is not a gap), so the report
     * must not read as a complete review.
     */
    incomplete: boolean;
    summary?: PrdImageReviewSummary;
  }> {
    const { document } = run;
    const describe = imageDescriber(document);
    if (document.images.length === 0) return { candidates: [], notReviewed: [], incomplete: false };
    if (!this.options.includeImages) {
      return {
        candidates: [],
        incomplete: false,
        notReviewed: document.images.map((image) =>
          describe(image, "images are not reviewed unless image review is turned on")
        ),
      };
    }

    return this.runPhase("images", "Reviewing images", async () => {
      const support = await this.checkImageSupport();
      if (!support.supported) {
        this.output.log(
          `⚠️ Images will not be reviewed: ${support.reason}. They are listed under “Not reviewed” in the report.\n`
        );
        return {
          candidates: [],
          incomplete: true,
          notReviewed: document.images.map((image) =>
            describe(image, `image review is not available (${support.reason})`)
          ),
          summary: { supported: false, reason: support.reason, reviewed: 0 },
        };
      }

      const { selected, notReviewed, duplicates } = this.selectImages(document, support, describe);
      const files = await this.extractImages(run.buffer, selected, run.paths);
      for (const image of selected) {
        if (!files.has(image.id)) {
          notReviewed.push(describe(image, "the image could not be extracted from the document"));
        }
      }

      const batches = imageBatches(
        selected.filter((image) => files.has(image.id)),
        run.chunks,
        imagesPerRequest(this.options.imageLimits, support)
      );
      const concurrency = this.streaming
        ? 1
        : Math.max(1, this.options.concurrency ?? DEFAULT_CONCURRENCY);
      const results = await runWithConcurrency(batches, concurrency, (batch) =>
        this.reviewImageBatch(document, batch, files)
      );

      const candidates: PrdCandidateFinding[] = [];
      let reviewed = 0;
      results.forEach((result, index) => {
        const batch = batches[index];
        if (!batch) return;
        if (result) {
          reviewed += batch.images.length;
          candidates.push(...result);
          return;
        }
        notReviewed.push(
          ...batch.images.map((image) =>
            describe(image, "could not be reviewed because the AI request failed")
          )
        );
      });
      this.output.log(`🖼️ Reviewed ${reviewed} of ${document.images.length} image(s).\n`);
      return {
        candidates,
        notReviewed,
        incomplete: notReviewed.some((item) => !duplicates.has(item)),
        summary: { supported: true, reviewed },
      };
    });
  }

  private async checkImageSupport(): Promise<ImageInputSupport> {
    if (!this.ai.checkImageSupport) {
      return {
        supported: false,
        reason: "the AI provider cannot report whether its model accepts images",
      };
    }
    try {
      return await this.ai.checkImageSupport();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { supported: false, reason: `the image support check failed (${message})` };
    }
  }

  /** Picks the images to review within the limits; lists the rest with a reason. */
  private selectImages(
    document: DocxDocument,
    support: Extract<ImageInputSupport, { supported: true }>,
    describe: ImageDescriber
  ): {
    selected: DocxImage[];
    notReviewed: PrdNotReviewedItem[];
    /** The `notReviewed` items that are identical copies of a selected image. */
    duplicates: ReadonlySet<PrdNotReviewedItem>;
  } {
    const limits = this.options.imageLimits;
    const mediaTypes = new Set(
      (support.mediaTypes ?? DEFAULT_IMAGE_MEDIA_TYPES).map((type) => type.toLowerCase())
    );
    const maxBytes = Math.min(
      limits?.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
      support.maxImageBytes ?? Number.POSITIVE_INFINITY
    );
    const maxImages = Math.max(0, limits?.maxImages ?? DEFAULT_MAX_IMAGES);
    const selected: DocxImage[] = [];
    const bySha = new Map<string, string>();
    const notReviewed: PrdNotReviewedItem[] = [];
    const duplicates = new Set<PrdNotReviewedItem>();

    for (const image of document.images) {
      const same = image.sha256 ? bySha.get(image.sha256) : undefined;
      let reason: string | undefined;
      let isDuplicate = false;
      if (!image.partPath || !image.sha256 || image.sizeBytes === undefined) {
        reason = "the image data could not be read from the document";
      } else if (!mediaTypes.has(image.contentType.toLowerCase())) {
        reason = `its format (${image.contentType}) cannot be read by the AI model`;
      } else if (image.sizeBytes > maxBytes) {
        reason = `it is larger than the ${formatMb(maxBytes)} image size limit`;
      } else if (same) {
        isDuplicate = true;
        reason = `it is the same picture as image ${same}, which is reviewed instead`;
      } else if (selected.length >= maxImages) {
        reason = `the review limit of ${maxImages} images per document was reached`;
      }
      if (reason) {
        const item = describe(image, reason);
        notReviewed.push(item);
        if (isDuplicate) duplicates.add(item);
        continue;
      }
      selected.push(image);
      if (image.sha256) bySha.set(image.sha256, image.id);
    }
    return { selected, notReviewed, duplicates };
  }

  /** Writes the selected images into the run's `images/` directory. */
  private async extractImages(
    buffer: Buffer,
    images: readonly DocxImage[],
    paths: PrdRunPaths
  ): Promise<Map<string, PromptImageFile>> {
    const files = new Map<string, PromptImageFile>();
    if (images.length === 0) return files;
    const data = await readDocxImageData(buffer, images);
    if (data.size === 0) return files;
    await this.fs.mkdir(paths.imagesDir, { recursive: true });
    for (const image of images) {
      const bytes = data.get(image.id);
      if (!bytes) continue;
      const mimeType = image.contentType.toLowerCase();
      const filePath = path.resolve(
        paths.imagesDir,
        `${image.id}${IMAGE_EXTENSIONS[mimeType] ?? ".bin"}`
      );
      await this.fs.writeFileBuffer(filePath, bytes);
      files.set(image.id, { path: filePath, mimeType });
    }
    return files;
  }

  /** Reviews one batch of images; returns undefined when the AI call failed. */
  private async reviewImageBatch(
    document: DocxDocument,
    batch: ImageBatch,
    files: ReadonlyMap<string, PromptImageFile>
  ): Promise<PrdCandidateFinding[] | undefined> {
    const label = `Images ${batch.images.map((image) => image.id).join(", ")}`;
    this.step(label, "start");
    try {
      const prompt = buildPrdImagePrompt({
        documentType: this.options.documentType,
        documentTitle: document.title,
        contextText: batch.chunk.text,
        images: batch.images.map((image) => ({
          id: image.id,
          sectionId: image.sectionId,
          ...(image.altText ? { altText: image.altText } : {}),
        })),
      });
      const imageFiles = batch.images.flatMap((image) => {
        const file = files.get(image.id);
        return file ? [file] : [];
      });
      const response = await this.ai.executePrompt(prompt, {
        promptType: "prd-image",
        discardSession: true,
        onSessionDiscardFailed: this.onSessionDiscardFailed,
        ...(this.transcriptDir ? { transcriptDir: this.transcriptDir } : {}),
        imageFiles,
        ...(this.streaming ? { onStreamData: this.stream("images") } : {}),
      });
      this.addUsage(response.tokenUsage);
      const parsed = PrdImageResultSchema.safeParse(parseAIJson(response));
      if (!parsed.success) {
        throw new MergeMentorError("the AI response for these images could not be read");
      }
      const ids = new Set(batch.images.map((image) => image.id));
      const known = new Set(
        PRD_RUBRICS[this.options.documentType].dimensions.map((dimension) => dimension.id)
      );
      const candidates = parsed.data.findings.flatMap((finding): PrdCandidateFinding[] => {
        const imageId = finding.imageId
          .trim()
          .replace(/^\[|\]$/g, "")
          .replace(/^image\s+/i, "");
        if (!ids.has(imageId) || finding.problem.trim().length === 0) return [];
        const dimension = finding.dimension.trim();
        return [
          {
            severity: finding.severity,
            dimension: known.has(dimension) ? dimension : "general",
            sectionId: finding.sectionId.trim().replace(/^\[|\]$/g, ""),
            quote: finding.quote,
            problem: finding.problem,
            suggestion: finding.suggestion,
            ...(finding.authorQuestion ? { authorQuestion: finding.authorQuestion } : {}),
            origin: "image",
            scopeSectionIds: batch.chunk.sectionIds,
            imageId,
          },
        ];
      });
      this.step(label, "done", `${candidates.length} possible issue(s)`);
      return candidates;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ chunk: batch.chunk.id, error: err.message }, "PRD image pass failed");
      this.output.log(`⚠️ ${label}: review failed (${err.message})`);
      this.step(label, "error", err.message);
      return undefined;
    }
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
    this.output.log(
      `${report.documentType.toUpperCase()} review: ${verdictLabel(report.readiness.verdict)}`
    );
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

/** Builds the "not reviewed" entry for an image with a reason. */
type ImageDescriber = (image: DocxImage, reason: string) => PrdNotReviewedItem;

function imageDescriber(document: DocxDocument): ImageDescriber {
  const headings = new Map(document.sections.map((s) => [s.id, s.headingPath.join(" › ")]));
  return (image, reason) => {
    const where = headings.get(image.sectionId);
    const alt = image.altText ? ` (“${image.altText}”)` : "";
    return {
      kind: "image",
      description: `Image ${image.id}${alt}${where ? ` in “${where}”` : ""}: ${reason}.`,
      sectionIds: [image.sectionId],
    };
  };
}

/** Images reviewed together in one AI call, with the document part they appear in. */
interface ImageBatch {
  readonly chunk: DocumentChunk;
  readonly images: readonly DocxImage[];
}

function imagesPerRequest(
  limits: PrdImageReviewLimits | undefined,
  support: Extract<ImageInputSupport, { supported: true }>
): number {
  return Math.max(
    1,
    Math.min(
      limits?.imagesPerRequest ?? DEFAULT_IMAGES_PER_REQUEST,
      support.maxImagesPerRequest ?? Number.POSITIVE_INFINITY
    )
  );
}

/**
 * Groups images by the chunk their paragraph was rendered in (falling back to
 * the first chunk of their section), then splits each group into batches.
 */
function imageBatches(
  images: readonly DocxImage[],
  chunks: readonly DocumentChunk[],
  perRequest: number
): ImageBatch[] {
  const groups = new Map<DocumentChunk, DocxImage[]>();
  for (const image of images) {
    const chunk =
      chunks.find((candidate) => candidate.paragraphIds.includes(image.paragraphId)) ??
      chunks.find((candidate) => candidate.sectionIds.includes(image.sectionId)) ??
      chunks[0];
    if (!chunk) continue;
    groups.set(chunk, [...(groups.get(chunk) ?? []), image]);
  }
  const batches: ImageBatch[] = [];
  for (const [chunk, group] of groups) {
    for (let start = 0; start < group.length; start += perRequest) {
      batches.push({ chunk, images: group.slice(start, start + perRequest) });
    }
  }
  return batches;
}

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
