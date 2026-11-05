/**
 * PRD / FRD work breakdown engine (`merge-mentor prd-breakdown`).
 *
 * Pipeline: load the document (a stored review run, or a `.docx` that is parsed
 * and chunked like a review does) → one extraction pass per chunk proposing
 * epics, features and PBIs → one ordering pass that merges duplicates, groups
 * the items and puts them in delivery order with dependencies → grounding of
 * every PBI's quote in the document text → Markdown + JSON breakdown.
 *
 * A breakdown is stored next to the run's review report
 * (`prd-<runId>-breakdown.md` / `.json`), so deleting the run removes it too.
 *
 * The document is untrusted input. Prompts wrap it in the security preamble
 * defences, and the AI client passed in must be created without write or
 * shell tools (the provider defaults). The model only proposes and orders
 * items; ids, numbering, dependency checks and quote grounding are done here
 * in code, and every extracted PBI ends up in the breakdown even when the
 * ordering pass misplaces it.
 */
import { createHash } from "node:crypto";
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
import {
  deletePrdRun,
  isSafePrdRunId,
  type PrdRunPaths,
  prdRunPaths,
} from "@merge-mentor/shared/reports/index.js";
import { mergeTokenUsage } from "@merge-mentor/shared/utils/tokenUsage.js";

import packageJson from "../../../package.json" with { type: "json" };
import type { PrdDocumentType } from "../../ai/prompts/prd.js";
import {
  buildPrdBreakdownExtractPrompt,
  buildPrdBreakdownOrganizePrompt,
  type PrdBreakdownCandidateEpic,
} from "../../ai/prompts/prdBreakdown.js";
import {
  PrdBreakdownExtractResultSchema,
  PrdBreakdownOrganizeResultSchema,
} from "../../ai/schemas.js";
import type { AIProviderClient, AIProviderType, TokenUsage } from "../../ai/types.js";
import { runWithConcurrency } from "../batching.js";
import type { ProgressStatus, ReviewPhaseId, ReviewProgressCallback } from "../progress.js";
import { parseAIJson } from "./aiJson.js";
import {
  countBreakdown,
  type PrdBreakdownEpic,
  type PrdBreakdownFeature,
  type PrdBreakdownOpenQuestion,
  type PrdBreakdownPbi,
  type PrdBreakdownReport,
  type PrdBreakdownUncoveredSection,
  renderPrdBreakdownMarkdown,
} from "./breakdownReport.js";
import { parseDocx, readDocxFile } from "./docxParser.js";
import type { DocxValidationOptions } from "./docxValidator.js";
import type { PrdReadinessVerdict } from "./prdReport.js";
import { DocumentTextIndex } from "./prdVerifier.js";
import { createRunId, type PrdDocumentSource, sourceFileName } from "./runNaming.js";
import { type ChunkOptions, chunkDocument } from "./sectionChunker.js";
import type { DocumentChunk, DocxBlock, DocxDocument } from "./types.js";

/** Where the breakdown gets its document from. */
type PrdBreakdownSource =
  /** A stored run (its `document.json`), e.g. one made by a review. */
  | { readonly fromRun: string }
  /** A `.docx` file or upload, stored as a new run. */
  | PrdDocumentSource;

/** Options for {@link runPrdBreakdown}. */
export interface PrdBreakdownOptions {
  readonly source: PrdBreakdownSource;
  /**
   * Document type of a new document (default `prd`). A stored run keeps the
   * type of its review.
   */
  readonly documentType?: PrdDocumentType;
  /** Break the document down even when its review found blockers. */
  readonly force?: boolean;
  /** Base directory for reports and run data (default `./.mergementor`). */
  readonly tempPath?: string;
  /** AI provider name, recorded in the report and shown in progress output. */
  readonly aiProvider?: AIProviderType;
  /** Model identifier, recorded in the report. */
  readonly aiModel?: string;
  /** Maximum parallel extraction passes (default 3; 1 while streaming). */
  readonly concurrency?: number;
  /** Maximum chunks read; the rest are listed as not covered (default 80). */
  readonly maxChunks?: number;
  /** Overrides for the section chunker (new documents only). */
  readonly chunkOptions?: ChunkOptions;
  /** Overrides for the `.docx` size and zip guards (new documents only). */
  readonly validation?: DocxValidationOptions;
  /** Run id to use for a new document instead of a generated one. */
  readonly runId?: string;
  /** Output writer for progress messages (default: consoleOutputWriter). */
  readonly output?: OutputWriter;
  /** Raw AI output chunks as they stream in (enables streaming). */
  readonly onStreamChunk?: (chunk: string) => void;
  /** Structured progress events (phases, per-section steps, AI stream deltas). */
  readonly onProgress?: ReviewProgressCallback;
}

/** Filesystem capabilities the engine uses (satisfied by `nodeFs`). */
type PrdBreakdownFileSystem = Pick<
  FileSystem,
  "stat" | "readFile" | "readFileBuffer" | "mkdir" | "writeFile" | "writeFileBuffer" | "rm"
>;

/** Collaborators for {@link runPrdBreakdown}. */
export interface PrdBreakdownDeps {
  /**
   * AI client for every pass. Create it without write or shell tools: the
   * prompts contain untrusted document text.
   */
  readonly aiClient: AIProviderClient;
  readonly fileSystem?: PrdBreakdownFileSystem;
  readonly clock?: Clock;
}

/** A completed breakdown. */
export interface PrdBreakdownResult {
  readonly runId: string;
  readonly report: PrdBreakdownReport;
  readonly reportMarkdown: string;
  /** Where the run's files were written. */
  readonly paths: PrdRunPaths;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_CHUNKS = 80;
/**
 * Most extracted PBIs listed for the ordering pass. Above this the listing
 * would not fit one request, so items keep the order of the document.
 */
const MAX_ORGANIZE_PBIS = 600;
/** Sections with less own text than this are headings or one-liners, not content. */
const MIN_COVERAGE_CHARS = 80;

// ---------------------------------------------------------------------------
// Internal model
// ---------------------------------------------------------------------------

interface CandidatePbi {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: readonly string[];
  readonly sectionId: string;
  readonly paragraphId?: string;
  readonly quote: string;
  readonly quoteVerified: boolean;
}

interface CandidateFeature {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly pbis: readonly CandidatePbi[];
}

interface CandidateEpic {
  readonly id: string;
  readonly title: string;
  readonly goal: string;
  readonly features: readonly CandidateFeature[];
}

interface ExtractSuccess {
  readonly ok: true;
  readonly chunk: DocumentChunk;
  readonly epics: readonly {
    readonly title: string;
    readonly goal: string;
    readonly features: readonly {
      readonly title: string;
      readonly description: string;
      readonly pbis: readonly Omit<CandidatePbi, "id">[];
    }[];
  }[];
  readonly openQuestions: readonly PrdBreakdownOpenQuestion[];
}

interface ExtractFailure {
  readonly ok: false;
  readonly chunk: DocumentChunk;
  readonly error: Error;
}

type ExtractResult = ExtractSuccess | ExtractFailure;

/** A group of items placed by the ordering pass (or by the fallback grouping). */
interface DraftFeature {
  title: string;
  description: string;
  pbiIds: string[];
}

interface DraftEpic {
  title: string;
  goal: string;
  rationale: string;
  features: DraftFeature[];
}

interface Organized {
  readonly epics: readonly DraftEpic[];
  readonly dependencies: ReadonlyMap<string, readonly string[]>;
  readonly summary: string;
  readonly gaps: readonly string[];
}

/** A stored run, loaded for the breakdown. */
interface LoadedDocument {
  readonly runId: string;
  readonly paths: PrdRunPaths;
  readonly fileName: string;
  readonly documentType: PrdDocumentType;
  readonly document: DocxDocument;
  readonly chunks: readonly DocumentChunk[];
  readonly sha256?: string;
  readonly review?: { readonly verdict: PrdReadinessVerdict };
  /** True when this call created the run, so a failure removes all of it. */
  readonly created: boolean;
}

/**
 * Breaks a PRD or FRD down into epics, features and PBIs and writes the
 * Markdown and JSON breakdown.
 *
 * @throws {ValidationError} for an unsafe or unknown run id, a review that
 *   found blockers (unless `force`), a file over the size cap, a file that is
 *   not a `.docx` or a document with no text
 * @throws {DocumentParseError} when a file cannot be read or parsed
 * @throws {MergeMentorError} when every extraction pass failed
 */
export async function runPrdBreakdown(
  options: PrdBreakdownOptions,
  deps: PrdBreakdownDeps
): Promise<PrdBreakdownResult> {
  return new PrdBreakdownRun(options, deps).run();
}

/** One execution of the pipeline; holds per-run state. */
class PrdBreakdownRun {
  private readonly logger = createChildLogger({ component: "PrdBreakdownEngine" });
  private readonly output: OutputWriter;
  private readonly fs: PrdBreakdownFileSystem;
  private readonly clock: Clock;
  private readonly ai: AIProviderClient;
  private readonly streaming: boolean;
  private tokenUsage: TokenUsage | undefined;
  private transcriptDir: string | undefined;
  private readonly discardFailures: string[] = [];
  private readonly onSessionDiscardFailed = (reason: string): void => {
    this.discardFailures.push(reason);
  };

  constructor(
    private readonly options: PrdBreakdownOptions,
    deps: PrdBreakdownDeps
  ) {
    this.output = options.output ?? consoleOutputWriter;
    this.fs = deps.fileSystem ?? nodeFs;
    this.clock = deps.clock ?? systemClock;
    this.ai = deps.aiClient;
    this.streaming = options.onStreamChunk !== undefined || options.onProgress !== undefined;
  }

  async run(): Promise<PrdBreakdownResult> {
    const { options } = this;
    const createdAt = this.clock.now();
    const loaded = await this.runPhase("resolve", "Reading document", () => this.load(createdAt));
    this.transcriptDir = path.resolve(loaded.paths.transcriptsDir);

    try {
      if (loaded.review?.verdict === "not-ready" && !options.force) {
        throw new ValidationError(
          "review",
          "the review of this document found blockers, so a work breakdown would be built on gaps. Fix them first, or break it down anyway"
        );
      }
      return await this.breakDown(loaded, createdAt);
    } catch (error) {
      if (this.discardFailures.length > 0) {
        this.output.error(
          `⚠️ The AI provider could not delete its saved conversation for ${this.discardFailures.length} request(s). Parts of the document may remain in the provider's own storage, outside the .mergementor folder.`
        );
      }
      await this.cleanUp(loaded);
      throw error;
    }
  }

  /**
   * Removes what a failed breakdown left behind. A new run is removed whole. A
   * stored run is left alone: it holds the review, and a breakdown made
   * earlier stays, because the report is only written once every AI request
   * has succeeded.
   */
  private async cleanUp(loaded: LoadedDocument): Promise<void> {
    if (!loaded.created) return;
    const tempPath = this.options.tempPath ?? "./.mergementor";
    try {
      await deletePrdRun(loaded.runId, { tempPath, fs: this.fs });
    } catch (cleanupError: unknown) {
      this.output.error(
        `⚠️ The breakdown failed and its files could not be fully removed (${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}). Delete ${loaded.paths.runDir} by hand if the document is confidential.`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  private async load(createdAt: Date): Promise<LoadedDocument> {
    const { source } = this.options;
    if ("fromRun" in source) return this.loadStoredRun(source.fromRun);
    return this.loadNewDocument(source, createdAt);
  }

  private async loadStoredRun(runId: string): Promise<LoadedDocument> {
    if (!isSafePrdRunId(runId)) {
      throw new ValidationError("runId", "must contain only letters, digits, '-' and '_'");
    }
    const paths = prdRunPaths(this.options.tempPath ?? "./.mergementor", runId);
    let stored: { document: DocxDocument; chunks: readonly DocumentChunk[] };
    try {
      stored = parseStoredDocument(await this.fs.readFile(paths.documentJson, "utf-8"));
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw new ValidationError(
          "runId",
          `no stored document was found for run ${runId}. Run a review of the document first, or break the file down directly`,
          { cause: error }
        );
      }
      // A truncated or damaged file is not a missing one: say what is wrong.
      throw new ValidationError(
        "runId",
        error instanceof SyntaxError
          ? `the stored document for run ${runId} is damaged and cannot be read`
          : `the stored document for run ${runId} could not be read (${error instanceof Error ? error.message : String(error)})`,
        { cause: error }
      );
    }
    if (stored.chunks.length === 0) {
      throw new ValidationError("runId", "the stored document has no text to break down");
    }
    const review = await this.readStoredReview(paths);
    return {
      runId,
      paths,
      fileName: review?.fileName ?? "document.docx",
      documentType: review?.documentType ?? this.options.documentType ?? "prd",
      document: stored.document,
      chunks: stored.chunks,
      ...(review?.sha256 ? { sha256: review.sha256 } : {}),
      ...(review ? { review: { verdict: review.verdict } } : {}),
      created: false,
    };
  }

  /** Reads what the breakdown needs from the run's review report, if it has one. */
  private async readStoredReview(paths: PrdRunPaths): Promise<
    | {
        verdict: PrdReadinessVerdict;
        documentType: PrdDocumentType;
        fileName: string;
        sha256?: string;
      }
    | undefined
  > {
    try {
      const report: unknown = JSON.parse(await this.fs.readFile(paths.reportJson, "utf-8"));
      if (!isRecord(report) || !isRecord(report.readiness) || !isRecord(report.source)) {
        return undefined;
      }
      const { verdict } = report.readiness;
      if (verdict !== "ready" && verdict !== "needs-work" && verdict !== "not-ready") {
        return undefined;
      }
      const documentType = report.documentType === "frd" ? "frd" : "prd";
      const fileName =
        typeof report.source.fileName === "string" && report.source.fileName.length > 0
          ? report.source.fileName
          : "document.docx";
      const sha256 = typeof report.source.sha256 === "string" ? report.source.sha256 : undefined;
      return { verdict, documentType, fileName, ...(sha256 ? { sha256 } : {}) };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return undefined;
      // A review report that exists but cannot be read must not pass for "no review".
      this.output.error(
        `⚠️ The review report of this run could not be read (${error instanceof Error ? error.message : String(error)}), so its verdict and document type are not known. Treating the document as a ${this.options.documentType ?? "prd"}.`
      );
      return undefined;
    }
  }

  private async pathExists(target: string): Promise<boolean> {
    try {
      await this.fs.stat(target);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return false;
      throw error;
    }
  }

  private async loadNewDocument(
    source: PrdDocumentSource,
    createdAt: Date
  ): Promise<LoadedDocument> {
    const { options } = this;
    const fileName = sourceFileName(source);
    const runId = options.runId ?? createRunId(createdAt, fileName);
    const paths = prdRunPaths(options.tempPath ?? "./.mergementor", runId);
    // A chosen id must not land on an existing run: that would overwrite its
    // document, and a later failure would then delete the run with its review.
    if (options.runId !== undefined && (await this.pathExists(paths.runDir))) {
      throw new ValidationError("runId", `a run with the id ${runId} already exists`);
    }
    this.output.log(`\n🧩 Breaking down ${fileName}...\n`);

    const buffer =
      "buffer" in source
        ? source.buffer
        : await readDocxFile(source.path, this.fs, { validation: options.validation });
    const { document, chunks } = await this.runPhase("fetch", "Parsing document", async () => {
      const parsed = await parseDocx(buffer, { validation: options.validation });
      const split = chunkDocument(parsed, options.chunkOptions);
      if (split.length === 0) {
        throw new ValidationError("docx", "the document has no text to break down");
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
    } catch (error) {
      await deletePrdRun(runId, {
        tempPath: options.tempPath ?? "./.mergementor",
        fs: this.fs,
      }).catch(() => undefined);
      throw error;
    }
    return {
      runId,
      paths,
      fileName,
      documentType: options.documentType ?? "prd",
      document,
      chunks,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      created: true,
    };
  }

  // -------------------------------------------------------------------------
  // Pipeline
  // -------------------------------------------------------------------------

  private async breakDown(loaded: LoadedDocument, createdAt: Date): Promise<PrdBreakdownResult> {
    const { options } = this;
    const { document, chunks, paths, runId } = loaded;
    const maxChunks = Math.max(1, options.maxChunks ?? DEFAULT_MAX_CHUNKS);
    const readChunks = chunks.slice(0, maxChunks);
    const skippedChunks = chunks.slice(maxChunks);
    const index = new DocumentTextIndex(document);
    this.output.log(
      `📋 ${document.sections.length} section(s) in ${chunks.length} part(s); reading ${readChunks.length} with ${options.aiProvider ?? "the configured AI provider"}...\n`
    );

    const extracted = await this.runPhase(
      "ai-review",
      `Finding work items in ${readChunks.length} part(s) of the document`,
      () => this.extractAll(loaded, readChunks, index)
    );
    const succeeded = extracted.filter((result): result is ExtractSuccess => result.ok);
    const failed = extracted.filter((result): result is ExtractFailure => !result.ok);

    const candidates = toCandidates(succeeded);
    const organized = await this.runPhase("organize", "Putting the work items in order", () =>
      this.organize(loaded, candidates)
    );
    const draft = organized ?? fallbackOrganization(candidates);
    const assembled = assemble(candidates, draft);
    const epics = withHeadingPaths(assembled.epics, index);
    const assemblyNotes = assembled.notes;

    const notes: string[] = [
      ...assemblyNotes,
      ...failed.map(
        (result) =>
          `${chunkLabel(result.chunk, chunks.length)}: no work items were drawn from this part because the AI request failed.`
      ),
      ...skippedChunks.map(
        (chunk) =>
          `${chunkLabel(chunk, chunks.length)}: not read because the document is longer than the limit of ${maxChunks} parts.`
      ),
      ...document.warnings.map((warning) => `Some content could not be read: ${warning}`),
    ];
    const unreadSections = new Set(
      [...failed.map((result) => result.chunk), ...skippedChunks].flatMap(
        (chunk) => chunk.sectionIds
      )
    );
    const questions = dedupeQuestions([
      ...succeeded.flatMap((result) => result.openQuestions),
      ...draft.gaps.map((gap): PrdBreakdownOpenQuestion => ({ question: gap, headingPath: [] })),
    ]);
    const complete = failed.length === 0 && skippedChunks.length === 0;

    const report: PrdBreakdownReport = {
      schemaVersion: 1,
      kind: "prd-breakdown",
      runId,
      createdAt: createdAt.toISOString(),
      documentType: loaded.documentType,
      source: { fileName: loaded.fileName, ...(loaded.sha256 ? { sha256: loaded.sha256 } : {}) },
      document: {
        ...(document.title ? { title: document.title } : {}),
        chunkCount: chunks.length,
        processedChunkCount: succeeded.length,
      },
      ...(loaded.review ? { review: loaded.review } : {}),
      summary: organized?.summary ?? "",
      ordered: organized !== undefined,
      complete,
      counts: countBreakdown(epics),
      epics,
      openQuestions: questions,
      uncoveredSections: uncoveredSections(document, index, epics, unreadSections),
      notes,
      ...(options.aiProvider ? { aiProvider: options.aiProvider } : {}),
      ...(options.aiModel ? { aiModel: options.aiModel } : {}),
      ...(this.tokenUsage ? { tokenUsage: this.tokenUsage } : {}),
      version: packageJson.version,
    };

    const reportMarkdown = await this.runPhase("report", "Saving breakdown", async () => {
      const markdown = renderPrdBreakdownMarkdown(report);
      await this.fs.mkdir(path.dirname(paths.breakdownMarkdown), { recursive: true });
      // JSON first: the Markdown is what the Reports page lists, so it only
      // appears once the structured breakdown it describes is in place.
      await this.fs.writeFile(paths.breakdownJson, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
      await this.fs.writeFile(paths.breakdownMarkdown, markdown, "utf-8");
      this.output.log(`📄 Work breakdown saved to: ${paths.breakdownMarkdown}\n`);
      return markdown;
    });

    this.displaySummary(report);
    return { runId, report, reportMarkdown, paths };
  }

  private async extractAll(
    loaded: LoadedDocument,
    chunks: readonly DocumentChunk[],
    index: DocumentTextIndex
  ): Promise<ExtractResult[]> {
    const concurrency = this.streaming
      ? 1
      : Math.max(1, this.options.concurrency ?? DEFAULT_CONCURRENCY);
    const results = await runWithConcurrency(chunks, concurrency, (chunk, position) =>
      this.extract(loaded, chunk, position, chunks.length, index)
    );
    if (results.length > 0 && results.every((result) => !result.ok)) {
      const firstError = results.find((result): result is ExtractFailure => !result.ok)?.error;
      throw new MergeMentorError(
        `None of the ${results.length} part(s) of the document could be read${firstError ? `: ${firstError.message}` : ""}`,
        { cause: firstError }
      );
    }
    return results;
  }

  private async extract(
    loaded: LoadedDocument,
    chunk: DocumentChunk,
    position: number,
    total: number,
    index: DocumentTextIndex
  ): Promise<ExtractResult> {
    const label = chunkLabel(chunk, total);
    this.step(label, "start");
    try {
      const prompt = buildPrdBreakdownExtractPrompt({
        documentType: loaded.documentType,
        documentTitle: loaded.document.title,
        chunkText: chunk.text,
        sectionIds: chunk.sectionIds,
        chunkIndex: position + 1,
        chunkCount: total,
        part: chunk.part,
      });
      const response = await this.ai.executePrompt(prompt, {
        promptType: "prd-breakdown-extract",
        discardSession: true,
        onSessionDiscardFailed: this.onSessionDiscardFailed,
        ...(this.transcriptDir ? { transcriptDir: this.transcriptDir } : {}),
        ...(this.streaming ? { onStreamData: this.stream("ai-review") } : {}),
      });
      this.addUsage(response.tokenUsage);
      const json = parseAIJson(response);
      const parsed = PrdBreakdownExtractResultSchema.safeParse(json);
      if (!parsed.success || !hasKeys(json, ["epics"])) {
        throw new MergeMentorError("the AI response for this part could not be read");
      }

      const ground = (sectionId: string, quote: string) =>
        groundQuote(index, chunk, sectionId, quote);
      const epics = parsed.data.epics.flatMap((epic) => {
        const features = epic.features.flatMap((feature) => {
          const pbis = feature.pbis
            .filter((pbi) => pbi.title.trim().length > 0)
            .map((pbi) => ({
              title: pbi.title.trim(),
              description: pbi.description.trim(),
              acceptanceCriteria: pbi.acceptanceCriteria
                .map((criterion) => criterion.trim())
                .filter((criterion) => criterion.length > 0),
              quote: pbi.quote.trim(),
              ...ground(pbi.sectionId, pbi.quote),
            }));
          return pbis.length === 0
            ? []
            : [{ title: feature.title.trim(), description: feature.description.trim(), pbis }];
        });
        return features.length === 0
          ? []
          : [{ title: epic.title.trim(), goal: epic.goal.trim(), features }];
      });
      const openQuestions = parsed.data.openQuestions
        .filter((item) => item.question.trim().length > 0)
        .map((item): PrdBreakdownOpenQuestion => {
          const found = ground(item.sectionId, item.quote);
          const cited = item.sectionId.trim().replace(/^\[|\]$/g, "");
          const sectionId = found.quoteVerified ? found.sectionId : index.has(cited) ? cited : "";
          return {
            question: item.question.trim(),
            ...(sectionId ? { sectionId } : {}),
            headingPath: index.headingPath(sectionId),
            ...(found.quoteVerified ? { quote: item.quote.trim() } : {}),
          };
        });

      const count = epics.reduce(
        (sum, epic) =>
          sum + epic.features.reduce((inner, feature) => inner + feature.pbis.length, 0),
        0
      );
      this.step(label, "done", `${count} work item(s)`);
      return { ok: true, chunk, epics, openQuestions };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ chunk: chunk.id, error: err.message }, "PRD breakdown extraction failed");
      this.output.log(`⚠️ ${label}: failed (${err.message})`);
      this.step(label, "error", err.message);
      return { ok: false, chunk, error: err };
    }
  }

  /** Orders and groups the extracted items; undefined when the pass could not run or be used. */
  private async organize(
    loaded: LoadedDocument,
    candidates: readonly CandidateEpic[]
  ): Promise<Organized | undefined> {
    const pbiCount = candidates.reduce(
      (sum, epic) => sum + epic.features.reduce((inner, feature) => inner + feature.pbis.length, 0),
      0
    );
    if (pbiCount === 0) return undefined;
    if (pbiCount > MAX_ORGANIZE_PBIS) {
      this.output.log(
        `⚠️ ${pbiCount} work items is too many to order in one request; they keep the order of the document.`
      );
      return undefined;
    }
    const { document } = loaded;
    const listed: PrdBreakdownCandidateEpic[] = candidates.map((epic) => ({
      id: epic.id,
      title: epic.title,
      goal: epic.goal,
      features: epic.features.map((feature) => ({
        id: feature.id,
        title: feature.title,
        description: feature.description,
        pbis: feature.pbis.map((pbi) => ({
          id: pbi.id,
          title: pbi.title,
          description: pbi.description,
          sectionId: pbi.sectionId,
        })),
      })),
    }));
    const prompt = buildPrdBreakdownOrganizePrompt({
      documentType: loaded.documentType,
      documentTitle: document.title,
      outline: document.sections
        .filter((section) => section.level > 0)
        .map((section) => `${section.id}: ${section.headingPath.join(" > ")}`),
      epics: listed,
    });
    try {
      const response = await this.ai.executePrompt(prompt, {
        promptType: "prd-breakdown-organize",
        discardSession: true,
        onSessionDiscardFailed: this.onSessionDiscardFailed,
        ...(this.transcriptDir ? { transcriptDir: this.transcriptDir } : {}),
        ...(this.streaming ? { onStreamData: this.stream("organize") } : {}),
      });
      this.addUsage(response.tokenUsage);
      const json = parseAIJson(response);
      const parsed = PrdBreakdownOrganizeResultSchema.safeParse(json);
      if (!parsed.success || !hasKeys(json, ["epics"])) {
        throw new MergeMentorError("the AI response for the ordering step could not be read");
      }
      const known = new Set(
        candidates.flatMap((epic) =>
          epic.features.flatMap((feature) => feature.pbis.map((pbi) => pbi.id))
        )
      );
      const epicsById = new Map(candidates.map((epic) => [epic.id, epic]));
      const featuresById = new Map(
        candidates.flatMap((epic) => epic.features.map((feature) => [feature.id, feature] as const))
      );
      const epics = parsed.data.epics
        .map((epic): DraftEpic => {
          const merged = epic.epicIds.flatMap((id) => epicsById.get(normaliseId(id)) ?? []);
          return {
            title: epic.title.trim() || merged[0]?.title || "",
            goal: epic.goal.trim() || merged.find((item) => item.goal)?.goal || "",
            rationale: epic.rationale.trim(),
            features: epic.features.map((feature) => {
              const mergedFeatures = feature.featureIds.flatMap(
                (id) => featuresById.get(normaliseId(id)) ?? []
              );
              return {
                title: feature.title.trim() || mergedFeatures[0]?.title || "",
                description:
                  feature.description.trim() ||
                  mergedFeatures.find((item) => item.description)?.description ||
                  "",
                pbiIds: feature.pbiIds.map(normaliseId).filter((id) => known.has(id)),
              };
            }),
          };
        })
        .filter((epic) => epic.features.some((feature) => feature.pbiIds.length > 0));
      if (epics.length === 0) {
        throw new MergeMentorError("the AI response for the ordering step placed no work items");
      }
      const dependencies = new Map<string, string[]>();
      for (const dependency of parsed.data.dependencies) {
        const id = normaliseId(dependency.pbiId);
        if (!known.has(id)) continue;
        dependencies.set(id, [
          ...(dependencies.get(id) ?? []),
          ...dependency.dependsOn.map(normaliseId),
        ]);
      }
      return {
        epics,
        dependencies,
        summary: parsed.data.summary.trim(),
        gaps: parsed.data.gaps.map((gap) => gap.trim()).filter((gap) => gap.length > 0),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ error: message }, "PRD breakdown ordering failed");
      this.output.log(`⚠️ Ordering the work items failed (${message})`);
      return undefined;
    }
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

  private displaySummary(report: PrdBreakdownReport): void {
    const { counts } = report;
    this.output.log("=".repeat(60));
    this.output.log(`${report.documentType.toUpperCase()} work breakdown`);
    this.output.log("=".repeat(60));
    if (report.summary) this.output.log(report.summary);
    this.output.log(
      `\nEpics: ${counts.epics} · Features: ${counts.features} · PBIs: ${counts.pbis} · Open questions: ${report.openQuestions.length}`
    );
    this.output.log(`${"=".repeat(60)}\n`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether an AI response carries every expected key. The result schemas treat a
 * missing field as empty, which would turn an empty or malformed answer (`{}`)
 * into a successful pass with nothing in it; an explicit `null` or empty list
 * is still a legitimate "none".
 */
function hasKeys(json: unknown, keys: readonly string[]): boolean {
  if (!isRecord(json)) return false;
  return keys.every((key) => json[key] !== undefined);
}

/** `[P3]`, `p3 ` and `P3` all name PBI P3. */
function normaliseId(id: string): string {
  return id
    .trim()
    .replace(/^\[|\]$/g, "")
    .toUpperCase();
}

/** Whether `value` is an array whose items all satisfy `check`. */
function isArrayOf(value: unknown, check: (item: Record<string, unknown>) => boolean): boolean {
  return Array.isArray(value) && value.every((item) => isRecord(item) && check(item));
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Reads a stored `document.json`, checking the parts the breakdown relies on,
 * so a damaged or hand-edited file fails with a clear message rather than a
 * TypeError somewhere later.
 */
function parseStoredDocument(raw: string): {
  document: DocxDocument;
  chunks: readonly DocumentChunk[];
} {
  const unreadable = new ValidationError(
    "runId",
    "the stored document is not in a readable format"
  );
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || !isRecord(value.document)) throw unreadable;
  const { document, chunks } = value;
  const sectionsOk = isArrayOf(
    document.sections,
    (section) =>
      typeof section.id === "string" &&
      typeof section.level === "number" &&
      isStringArray(section.headingPath) &&
      isStringArray(section.childIds) &&
      Array.isArray(section.blocks)
  );
  const chunksOk = isArrayOf(
    chunks,
    (chunk) =>
      typeof chunk.id === "string" &&
      typeof chunk.text === "string" &&
      isStringArray(chunk.sectionIds) &&
      isStringArray(chunk.headingPath)
  );
  if (!sectionsOk || !chunksOk || !Array.isArray(document.images)) throw unreadable;
  return {
    document: {
      ...(document as unknown as DocxDocument),
      warnings: isStringArray(document.warnings) ? (document.warnings as string[]) : [],
    },
    chunks: chunks as DocumentChunk[],
  };
}

/**
 * Finds a quote in the document: first in the chunk it was read from, then
 * anywhere. An unfound quote keeps the section the model named (when it is one
 * of the chunk's) and is marked unverified.
 */
function groundQuote(
  index: DocumentTextIndex,
  chunk: DocumentChunk,
  sectionId: string,
  quote: string
): { sectionId: string; paragraphId?: string; quoteVerified: boolean } {
  // The prompt asks for the source section, so look there first: a phrase that
  // also appears in an earlier section of the chunk must not be credited to it.
  const cited = sectionId.trim().replace(/^\[|\]$/g, "");
  const found =
    (chunk.sectionIds.includes(cited) ? index.locate(quote, [cited]) : undefined) ??
    index.locate(quote, chunk.sectionIds) ??
    index.locate(quote, null);
  if (found) {
    return {
      sectionId: found.sectionId,
      ...(found.paragraphId ? { paragraphId: found.paragraphId } : {}),
      quoteVerified: true,
    };
  }
  return {
    sectionId: chunk.sectionIds.includes(cited) ? cited : (chunk.sectionIds[0] ?? ""),
    quoteVerified: false,
  };
}

/** Gives every extracted epic, feature and PBI an id, in document order. */
function toCandidates(results: readonly ExtractSuccess[]): CandidateEpic[] {
  let epicNumber = 0;
  let featureNumber = 0;
  let pbiNumber = 0;
  return results.flatMap((result) =>
    result.epics.map((epic): CandidateEpic => ({
      id: `E${++epicNumber}`,
      title: epic.title || "Untitled epic",
      goal: epic.goal,
      features: epic.features.map((feature): CandidateFeature => ({
        id: `F${++featureNumber}`,
        title: feature.title || "Untitled feature",
        description: feature.description,
        pbis: feature.pbis.map((pbi) => ({ id: `P${++pbiNumber}`, ...pbi })),
      })),
    }))
  );
}

function cleanName(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function sameName(a: string, b: string): boolean {
  return cleanName(a) === cleanName(b);
}

/**
 * Groups the extracted items in document order, merging epics and features
 * with the same title. Used when the ordering pass could not run.
 */
function fallbackOrganization(candidates: readonly CandidateEpic[]): Organized {
  const epics: DraftEpic[] = [];
  for (const candidate of candidates) {
    let epic = epics.find((item) => sameName(item.title, candidate.title));
    if (!epic) {
      epic = { title: candidate.title, goal: candidate.goal, rationale: "", features: [] };
      epics.push(epic);
    } else if (!epic.goal) {
      epic.goal = candidate.goal;
    }
    for (const candidateFeature of candidate.features) {
      let feature = epic.features.find((item) => sameName(item.title, candidateFeature.title));
      if (!feature) {
        feature = {
          title: candidateFeature.title,
          description: candidateFeature.description,
          pbiIds: [],
        };
        epic.features.push(feature);
      }
      feature.pbiIds.push(...candidateFeature.pbis.map((pbi) => pbi.id));
    }
  }
  return { epics, dependencies: new Map(), summary: "", gaps: [] };
}

/**
 * Builds the numbered epics from the ordering pass: every extracted PBI is
 * placed exactly once (strays go under a "needs placement" group), numbers are
 * positional, and a dependency survives only when it names a real PBI that
 * comes earlier in the order.
 */
function assemble(
  candidates: readonly CandidateEpic[],
  organized: Organized
): { epics: PrdBreakdownEpic[]; notes: string[] } {
  const pbis = new Map<string, CandidatePbi>();
  for (const epic of candidates) {
    for (const feature of epic.features) for (const pbi of feature.pbis) pbis.set(pbi.id, pbi);
  }

  const placed = new Set<string>();
  const drafts: DraftEpic[] = organized.epics.map((epic) => ({
    ...epic,
    features: epic.features.map((feature) => ({
      ...feature,
      pbiIds: feature.pbiIds.filter((id) => {
        if (placed.has(id)) return false;
        placed.add(id);
        return true;
      }),
    })),
  }));
  const stray = [...pbis.keys()].filter((id) => !placed.has(id));
  if (stray.length > 0) {
    drafts.push({
      title: "Needs placement",
      goal: "Work items that could not be matched to an epic or feature.",
      rationale: "",
      features: [
        {
          title: "Items to place",
          description: "Decide where these belong and in which order to build them.",
          pbiIds: stray,
        },
      ],
    });
  }

  const numberById = new Map<string, string>();
  const order = new Map<string, number>();
  const epicOf = new Map<string, string>();
  const built = drafts.flatMap((epic) => {
    const features = epic.features.filter((feature) => feature.pbiIds.length > 0);
    return features.length === 0 ? [] : [{ ...epic, features }];
  });
  built.forEach((epic, epicIndex) => {
    epic.features.forEach((feature, featureIndex) => {
      feature.pbiIds.forEach((id, pbiIndex) => {
        numberById.set(id, `${epicIndex + 1}.${featureIndex + 1}.${pbiIndex + 1}`);
        order.set(id, order.size);
        epicOf.set(id, String(epicIndex + 1));
      });
    });
  });

  let droppedDependencies = 0;
  const dependsOn = (id: string): string[] => {
    const own = order.get(id) ?? 0;
    const kept = new Set<string>();
    for (const target of organized.dependencies.get(id) ?? []) {
      const targetOrder = order.get(target);
      if (target === id || targetOrder === undefined || targetOrder >= own) {
        droppedDependencies += 1;
        continue;
      }
      kept.add(target);
    }
    return [...kept]
      .toSorted((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
      .flatMap((target) => numberById.get(target) ?? []);
  };

  const epics: PrdBreakdownEpic[] = built.map((epic, epicIndex) => {
    const epicNumber = String(epicIndex + 1);
    const needs = new Set<string>();
    const features = epic.features.map((feature, featureIndex): PrdBreakdownFeature => {
      const items = feature.pbiIds.flatMap((id): PrdBreakdownPbi[] => {
        const pbi = pbis.get(id);
        const number = numberById.get(id);
        if (!pbi || !number) return [];
        const depends = dependsOn(id);
        for (const target of depends) {
          const targetEpic = target.split(".")[0];
          if (targetEpic && targetEpic !== epicNumber) needs.add(targetEpic);
        }
        return [
          {
            number,
            title: pbi.title,
            description: pbi.description,
            acceptanceCriteria: pbi.acceptanceCriteria,
            dependsOn: depends,
            sectionId: pbi.sectionId,
            headingPath: [],
            ...(pbi.paragraphId ? { paragraphId: pbi.paragraphId } : {}),
            quote: pbi.quote,
            quoteVerified: pbi.quoteVerified,
          },
        ];
      });
      return {
        number: `${epicNumber}.${featureIndex + 1}`,
        title: feature.title || "Untitled feature",
        description: feature.description,
        pbis: items,
      };
    });
    return {
      number: epicNumber,
      title: epic.title || "Untitled epic",
      goal: epic.goal,
      rationale: epic.rationale,
      dependsOn: [...needs].toSorted((a, b) => Number(a) - Number(b)),
      features,
    };
  });

  const notes: string[] = [];
  if (stray.length > 0) {
    notes.push(
      `${stray.length} work item${stray.length === 1 ? " was" : "s were"} not placed by the ordering step and ${stray.length === 1 ? "is" : "are"} listed under “Needs placement”.`
    );
  }
  if (droppedDependencies > 0) {
    notes.push(
      `${droppedDependencies} dependenc${droppedDependencies === 1 ? "y was" : "ies were"} left out because ${droppedDependencies === 1 ? "it pointed" : "they pointed"} at an unknown item or one that comes later in the order.`
    );
  }
  return { epics, notes };
}

/** Fills in the heading path of every PBI from its section (done once the tree is built). */
function withHeadingPaths(
  epics: readonly PrdBreakdownEpic[],
  index: DocumentTextIndex
): PrdBreakdownEpic[] {
  return epics.map((epic) => ({
    ...epic,
    features: epic.features.map((feature) => ({
      ...feature,
      pbis: feature.pbis.map((pbi) => ({ ...pbi, headingPath: index.headingPath(pbi.sectionId) })),
    })),
  }));
}

function dedupeQuestions(
  questions: readonly PrdBreakdownOpenQuestion[]
): PrdBreakdownOpenQuestion[] {
  const seen = new Set<string>();
  return questions.filter((item) => {
    const key = item.question.toLowerCase().replace(/\s+/g, " ").trim();
    if (key.length === 0 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ownTextLength(blocks: readonly DocxBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    if (block.kind === "paragraph") total += block.paragraph.text.trim().length;
    else {
      for (const row of block.table.rows) {
        for (const cell of row.cells) total += ownTextLength(cell.blocks);
      }
    }
  }
  return total;
}

/**
 * Sections with real text of their own that no work item (or item in a
 * subsection) points to. Sections of unread parts are not listed: the notes
 * already say they were not read.
 */
function uncoveredSections(
  document: DocxDocument,
  index: DocumentTextIndex,
  epics: readonly PrdBreakdownEpic[],
  unread: ReadonlySet<string>
): PrdBreakdownUncoveredSection[] {
  const cited = new Set<string>();
  for (const epic of epics) {
    for (const feature of epic.features) for (const pbi of feature.pbis) cited.add(pbi.sectionId);
  }
  return document.sections
    .filter(
      (section) =>
        section.level > 0 &&
        !unread.has(section.id) &&
        ownTextLength(section.blocks) >= MIN_COVERAGE_CHARS &&
        !index.subtree(section.id).some((id) => cited.has(id))
    )
    .map((section) => ({ sectionId: section.id, headingPath: section.headingPath }));
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
