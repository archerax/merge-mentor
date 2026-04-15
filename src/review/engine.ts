import path from "node:path";
import {
  type AIProviderClient,
  type AIProviderType,
  type AIResponse,
  createAIProvider,
} from "../ai/index.js";
import { formatExistingCommentsContext } from "../ai/prompts/commentContext.js";
import { buildFilesSummary } from "../ai/prompts/prompts.js";
import {
  buildGeneralCrossFilePrompt,
  buildGeneralFileReviewPrompt,
  type GeneralCrossFileContext,
} from "../ai/prompts/specialists/general.js";
import {
  buildPerformanceCrossFilePrompt,
  buildPerformanceFileReviewPrompt,
  type PerformanceCrossFileContext,
} from "../ai/prompts/specialists/performance.js";
import {
  buildSecurityCrossFilePrompt,
  buildSecurityFileReviewPrompt,
  type SecurityCrossFileContext,
} from "../ai/prompts/specialists/security.js";
import {
  buildTestingCrossFilePrompt,
  buildTestingFileReviewPrompt,
} from "../ai/prompts/specialists/testing.js";
import type {
  SupportedLanguage,
  TestingCrossFileContext,
  TestingReviewContext,
} from "../ai/prompts/specialists/types.js";
import { getAuditLogger } from "../audit/index.js";
import { SKIP_EXTENSIONS } from "../constants.js";
import { ValidationError } from "../errors/index.js";
import { createChildLogger } from "../logger.js";
import type {
  CommentAction,
  CrossFileReviewResult,
  ExistingComment,
  FileReviewResult,
  PlatformAdapter,
  PRDetails,
  PRFile,
} from "../platforms/types.js";
import { consoleOutputWriter, type FileSystem, nodeFs, type OutputWriter } from "../ports/index.js";
import { findNearestValidLine, getValidDiffLines } from "../utils/diffParser.js";
import { detectLanguage } from "../utils/languageDetector.js";
import { StreamingDisplay } from "../utils/streamingDisplay.js";
import { findTestFileForProduction, isTestFile } from "../utils/testFileMapper.js";
import { CommentManager } from "./commentManager.js";
import { type DiffManifest, DiffStorage } from "./diffStorage.js";
import { FindingAggregator } from "./findingAggregator.js";
import { RepoManager } from "./repoManager.js";
import { ReviewStateCache } from "./reviewStateCache.js";

/** Result of a complete PR review. */
export interface ReviewResult {
  readonly prDetails: PRDetails;
  readonly filesReviewed: number;
  readonly filesSkipped: number;
  readonly fileResults: readonly FileReviewResult[];
  readonly crossFileResult: CrossFileReviewResult;
  readonly commentsCreated: number;
  readonly commentErrors: readonly string[];
}

/** Options for configuring the review engine. */
interface ReviewEngineOptions {
  readonly verbose?: boolean;
  readonly dryRun?: boolean;
  /** @deprecated Use aiModel instead */
  readonly copilotModel?: string;
  /** @deprecated Use aiTimeoutMs instead */
  readonly copilotTimeoutMs?: number;
  /** Copilot GitHub token for CLI authentication */
  readonly copilotToken?: string;
  /** Model to use for the AI provider */
  readonly aiModel?: string;
  /** Timeout in milliseconds for AI provider operations */
  readonly aiTimeoutMs?: number;
  /** Skip pre-existing issues (issues not introduced in this PR). */
  readonly skipPreExisting?: boolean;
  /** Number of review runs (1-5). Multiple runs aggregate findings. */
  readonly reviewRuns?: number;
  /** Type of review to perform (general, testing, security, performance). Default: general */
  readonly reviewType?: string;
  /** Enable streaming output display. Default: true (if TTY) */
  readonly streamingEnabled?: boolean;
  /** Number of lines in streaming display. Default: 5 */
  readonly streamingLines?: number;
  /** Base path for temporary files (cache, diffs, logs, repos, etc.). */
  readonly tempPath?: string;
  /**
   * Path to a pre-existing local repository checkout.
   * When provided (e.g. in CI where the repo is already checked out),
   * the engine uses this path directly and skips cloning.
   */
  readonly localWorkspacePath?: string;
  /** Output writer for console output. Default: consoleOutputWriter */
  readonly output?: OutputWriter;
  /** File system abstraction for I/O operations. Default: nodeFs */
  readonly fileSystem?: FileSystem;
}

/**
 * Orchestrates the PR review process.
 * Coordinates between platform adapters, AI provider, and comment management.
 */
export class ReviewEngine {
  private readonly platform: PlatformAdapter;
  private readonly provider: AIProviderClient;
  private readonly commentManager: CommentManager;
  private readonly stateCache: ReviewStateCache;
  private readonly repoManager: RepoManager;
  private readonly output: OutputWriter;
  private readonly fileSystem: FileSystem;
  private readonly options: ReviewEngineOptions;
  private readonly logger = createChildLogger({ component: "ReviewEngine" });
  private readonly auditLogger = getAuditLogger();
  private platformName = "unknown";
  private readonly streamingEnabled: boolean;
  private readonly streamingLines: number;

  constructor(
    platform: PlatformAdapter,
    botIdentifier: string,
    providerType?: AIProviderType | ReviewEngineOptions,
    options?: ReviewEngineOptions
  ) {
    this.platform = platform;

    // Handle overloaded constructor for backward compatibility
    let resolvedOptions: ReviewEngineOptions | undefined;
    let resolvedProviderType: AIProviderType;

    if (typeof providerType === "string") {
      resolvedProviderType = providerType;
      resolvedOptions = options;
    } else {
      // Legacy signature: (platform, botIdentifier, options)
      resolvedProviderType = "copilot";
      resolvedOptions = providerType;
    }

    // Resolve model and timeout (support both legacy and new options)
    const model = resolvedOptions?.aiModel ?? resolvedOptions?.copilotModel;
    const timeoutMs = resolvedOptions?.aiTimeoutMs ?? resolvedOptions?.copilotTimeoutMs;
    const tempPath = resolvedOptions?.tempPath ?? path.join(process.cwd(), ".mergementor");

    // Build provider options
    const providerOptions = {
      model,
      timeoutMs,
      token:
        resolvedProviderType === "copilot" || resolvedProviderType === "copilot-sdk"
          ? resolvedOptions?.copilotToken
          : undefined,
      tempPath,
    };

    this.output = resolvedOptions?.output ?? consoleOutputWriter;
    this.fileSystem = resolvedOptions?.fileSystem ?? nodeFs;
    this.provider = createAIProvider(resolvedProviderType, providerOptions);
    this.commentManager = new CommentManager(botIdentifier, {
      skipPreExisting: resolvedOptions?.skipPreExisting,
    });
    this.stateCache = new ReviewStateCache(tempPath);
    this.repoManager = new RepoManager(tempPath);
    this.options = resolvedOptions ?? {};
    this.streamingEnabled = resolvedOptions?.streamingEnabled ?? true;
    this.streamingLines = resolvedOptions?.streamingLines ?? 5;
    this.platformName = platform.constructor.name.toLowerCase().includes("github")
      ? "github"
      : "azure";
    this.logger.info(
      {
        aiProvider: resolvedProviderType,
        aiModel: model,
        aiTimeoutMs: timeoutMs,
        dryRun: resolvedOptions?.dryRun,
        skipPreExisting: resolvedOptions?.skipPreExisting,
        reviewRuns: resolvedOptions?.reviewRuns ?? 1,
        reviewType: resolvedOptions?.reviewType ?? "general",
      },
      "ReviewEngine initialized"
    );
  }

  /**
   * Creates a streaming display and returns a callback for streaming data.
   * Returns undefined callback if streaming is disabled.
   */
  private createStreamingCallback(context: string): {
    callback: ((chunk: string) => void) | undefined;
    finish: () => void;
  } {
    if (!this.streamingEnabled) {
      return { callback: undefined, finish: () => {} };
    }

    const display = new StreamingDisplay({
      maxLines: this.streamingLines,
      title: `🤖 ${context}`,
      enabled: this.streamingEnabled,
    });

    return {
      callback: (chunk: string) => display.push(chunk),
      finish: () => display.finish(),
    };
  }

  /**
   * Reviews a pull request and posts/updates comments.
   *
   * @param prNumber - The PR number to review
   * @returns Complete review results including findings and comment stats
   * @throws {ValidationError} When prNumber is invalid
   *
   * @example
   * ```typescript
   * const engine = new ReviewEngine(githubAdapter, '[Bot]', 'copilot', { dryRun: true });
   * const result = await engine.reviewPR(123);
   * console.log(`Reviewed ${result.filesReviewed} files`);
   * console.log(`Skipped ${result.filesSkipped} unchanged files`);
   * console.log(`Found ${result.fileResults.reduce((sum, r) => sum + r.findings.length, 0)} issues`);
   * ```
   */
  async reviewPR(prNumber: number): Promise<ReviewResult> {
    if (prNumber <= 0 || !Number.isInteger(prNumber)) {
      this.logger.error({ prNumber }, "Invalid PR number");
      throw new ValidationError("prNumber", "Must be a positive integer");
    }

    // Generate unique PR identifier
    const projectId = this.platform.getProjectIdentifier();
    const prIdentifier = `${this.platformName.charAt(0).toUpperCase() + this.platformName.slice(1)}-${projectId}-PR${prNumber}`;

    const runs = this.options.reviewRuns ?? 1;
    const reviewType = this.options.reviewType ?? "general";
    this.logger.info({ prNumber, prIdentifier, runs, reviewType }, "Starting PR review");
    this.log(`Starting review of PR #${prNumber}...`);
    this.auditLogger.logReviewStart(prNumber, this.platformName, runs, reviewType);

    const { prDetails, files } = await this.fetchPRData(prNumber);
    const existingComments = await this.fetchExistingComments(prNumber);
    const cachedState = await this.stateCache.getState(prIdentifier);

    // Use pre-existing workspace (CI checkout) or clone the repo for CLI agent access
    const repoPath = await this.resolveWorkspace(prDetails.baseBranch);

    let fileResults: FileReviewResult[];
    let crossFileResult: CrossFileReviewResult;
    let filesSkipped: number;

    // Fast review combines file and cross-file analysis in a single pass
    if (reviewType === "fast") {
      this.log("Using fast review mode (single-pass file + architectural analysis)...");
      const fastReviewData = await this.performFastReview(
        prIdentifier,
        prDetails,
        files,
        existingComments,
        repoPath
      );
      fileResults = fastReviewData.fileResults;
      crossFileResult = fastReviewData.crossFileResult;
      filesSkipped = 0; // Fast review doesn't use caching yet

      // Validate line numbers against actual diff content
      fileResults = this.validateLineNumbers(fileResults, files);
    } else if (runs === 1) {
      // Single run - use existing logic
      const reviewData = await this.reviewFiles(
        prIdentifier,
        files,
        existingComments,
        cachedState,
        repoPath
      );
      fileResults = reviewData.fileResults;
      filesSkipped = reviewData.filesSkipped;

      // Validate line numbers against actual diff content
      fileResults = this.validateLineNumbers(fileResults, files);

      // Skip cross-file analysis if all files were cached
      if (filesSkipped > 0 && filesSkipped === fileResults.length && cachedState?.crossFileResult) {
        this.log("All files unchanged - using cached cross-file analysis");
        this.logger.info({ prNumber }, "Reusing cached cross-file analysis");
        crossFileResult = cachedState.crossFileResult;
      } else {
        crossFileResult = await this.performCrossFileAnalysis(
          prDetails,
          files,
          fileResults,
          existingComments,
          repoPath
        );
      }
    } else {
      // Multi-run mode - aggregate findings from multiple runs
      const aggregated = await this.reviewPRMultiRun(
        prNumber,
        prIdentifier,
        prDetails,
        files,
        runs,
        existingComments,
        repoPath
      );
      fileResults = aggregated.fileResults;
      crossFileResult = aggregated.crossFileResult;
      filesSkipped = 0; // Multi-run doesn't skip files
    }

    const actions = this.commentManager.determineActions(
      existingComments,
      fileResults,
      crossFileResult
    );

    const commentStats = await this.executeCommentActions(prNumber, actions);

    // Save state for future re-reviews
    const fileShaMap = this.buildFileShaMap(files);
    await this.stateCache.saveState(prIdentifier, fileResults, fileShaMap, crossFileResult);

    if (commentStats.commentErrors.length > 0) {
      this.logger.warn(
        {
          errorCount: commentStats.commentErrors.length,
          errors: commentStats.commentErrors,
        },
        "Some comments failed to post"
      );
      this.log(`\n⚠️  ${commentStats.commentErrors.length} comment(s) failed to post`);
    }

    this.logger.info(
      {
        prNumber,
        filesReviewed: fileResults.length,
        filesSkipped,
        totalFindings: fileResults.reduce((sum, r) => sum + r.findings.length, 0),
        commentsCreated: commentStats.commentsCreated,
        commentErrors: commentStats.commentErrors.length,
      },
      "PR review completed"
    );

    this.auditLogger.logReviewComplete(
      prNumber,
      this.platformName,
      fileResults.length - filesSkipped,
      filesSkipped,
      commentStats.commentsCreated,
      commentStats.commentErrors.length
    );

    return {
      prDetails,
      filesReviewed: fileResults.length - filesSkipped,
      filesSkipped,
      fileResults,
      crossFileResult,
      ...commentStats,
    };
  }

  /**
   * Performs multiple review runs and aggregates findings.
   */
  private async reviewPRMultiRun(
    prNumber: number,
    prIdentifier: string,
    prDetails: PRDetails,
    files: PRFile[],
    runs: number,
    existingComments: readonly ExistingComment[],
    repoPath?: string
  ): Promise<{ fileResults: FileReviewResult[]; crossFileResult: CrossFileReviewResult }> {
    const allFileResults: FileReviewResult[][] = [];
    const allCrossFileResults: CrossFileReviewResult[] = [];

    this.log(`\n🔄 Multi-run mode: performing ${runs} review runs...`);

    // Accumulate findings from each run to provide context to subsequent runs
    const accumulatedFindings: FileReviewResult[] = [];

    for (let run = 1; run <= runs; run++) {
      this.log(`\n📝 Review run ${run} of ${runs}...`);
      this.logger.info({ prNumber, run, totalRuns: runs }, "Starting review run");

      try {
        // For runs after the first, create synthetic "existing comments" from previous findings
        const runComments =
          run === 1
            ? existingComments
            : this.createSyntheticComments(existingComments, accumulatedFindings);

        // Perform file reviews for this run (no caching in multi-run mode)
        const { fileResults } = await this.reviewFiles(
          prIdentifier,
          files,
          runComments,
          undefined,
          repoPath
        );
        const validatedResults = this.validateLineNumbers(fileResults, files);
        allFileResults.push(validatedResults);

        // Accumulate findings for next run's context
        accumulatedFindings.push(...validatedResults);

        // Perform cross-file analysis for this run
        const crossFileResult = await this.performCrossFileAnalysis(
          prDetails,
          files,
          validatedResults,
          runComments,
          repoPath
        );
        allCrossFileResults.push(crossFileResult);

        this.log(
          `  Run ${run}: Found ${validatedResults.reduce((sum, r) => sum + r.findings.length, 0)} file issues, ${crossFileResult.findings.length} cross-file issues`
        );

        // Delay between runs to avoid rate limits (except after last run)
        if (run < runs) {
          this.log("  Waiting 2 seconds before next run...");
          await this.delay(2000);
        }
      } catch (error) {
        this.logger.error({ prNumber, run, error: (error as Error).message }, "Review run failed");
        this.log(`  ⚠️  Run ${run} failed: ${(error as Error).message}`);
        // Continue with remaining runs
      }
    }

    // Aggregate findings from all successful runs
    const aggregator = new FindingAggregator();
    const aggregatedFileResults = aggregator.aggregateFileFindings(allFileResults);
    const aggregatedCrossFile = aggregator.aggregateCrossFileFindings(allCrossFileResults);

    const totalFindings = aggregatedFileResults.reduce((sum, r) => sum + r.findings.length, 0);
    this.log(
      `\n✅ Aggregated ${totalFindings} unique file findings and ${aggregatedCrossFile.findings.length} cross-file findings from ${allFileResults.length} successful run(s)`
    );

    return {
      fileResults: aggregatedFileResults,
      crossFileResult: aggregatedCrossFile,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchPRData(prNumber: number): Promise<{ prDetails: PRDetails; files: PRFile[] }> {
    this.log("Fetching PR details...");
    this.logger.debug({ prNumber }, "Fetching PR data");
    const prDetails = await this.platform.getPRDetails(prNumber);
    const files = await this.platform.getPRFiles(prNumber);
    this.logger.info(
      {
        prNumber,
        filesCount: files.length,
        title: prDetails.title,
        author: prDetails.author,
      },
      "PR data fetched"
    );
    this.log(`Found ${files.length} changed files`);
    return { prDetails, files };
  }

  private async fetchExistingComments(prNumber: number) {
    this.log("Fetching existing bot comments...");
    this.logger.debug({ prNumber }, "Fetching existing comments");
    const existingComments = await this.platform.getExistingBotComments(prNumber);
    this.logger.info(
      {
        prNumber,
        commentCount: existingComments.length,
      },
      "Existing comments fetched"
    );
    this.log(`Found ${existingComments.length} existing bot comments`);
    return existingComments;
  }

  /**
   * Returns the path to the repository workspace for CLI agent access.
   * Uses a pre-existing local checkout when available (e.g. in CI), otherwise
   * clones the repository to a local temp directory.
   */
  private async resolveWorkspace(branch: string): Promise<string> {
    const localPath = this.options.localWorkspacePath;
    if (localPath) {
      try {
        await this.fileSystem.access(localPath);
      } catch {
        throw new Error(
          `CI workspace path does not exist or is not accessible: ${localPath}. ` +
            "Ensure the repository has been checked out before running merge-mentor."
        );
      }
      this.log(`📦 Using CI workspace: ${localPath}`);
      this.logger.info({ localPath }, "Using pre-existing CI workspace, skipping clone");
      return localPath;
    }
    return this.ensureRepoCloned(branch);
  }

  /**
   * Ensures repository is cloned for CLI agent workspace access.
   * Returns the path to the cloned repository.
   * @throws {Error} If repository cloning fails
   */
  private async ensureRepoCloned(branch: string): Promise<string> {
    this.log("📦 Cloning repository for workspace access...");
    this.logger.debug({ branch }, "Ensuring repository is cloned");

    const repoInfo = this.platform.getRepoInfo();
    const token = this.platform.getToken();

    try {
      const repoPath = await this.repoManager.ensureRepo(repoInfo, branch, token);

      this.log(`  ✓ Repository ready at: ${repoPath}`);
      this.logger.info({ repoPath }, "Repository cloned successfully");
      return repoPath;
    } catch (error) {
      const errorMsg = `Failed to clone repository: ${(error as Error).message}`;
      this.log(`  ❌ ${errorMsg}`);
      this.logger.error(
        { error: (error as Error).message, branch },
        "Repository cloning failed, aborting review"
      );
      throw new Error(errorMsg);
    }
  }

  private async reviewFiles(
    prIdentifier: string,
    files: PRFile[],
    existingComments: readonly ExistingComment[],
    cachedState?: Awaited<ReturnType<ReviewStateCache["getState"]>>,
    repoPath?: string
  ): Promise<{ fileResults: FileReviewResult[]; filesSkipped: number }> {
    // Filter out files that should be skipped
    const filesToReview: PRFile[] = [];
    const cachedResults: FileReviewResult[] = [];
    let filesSkipped = 0;

    for (const file of files) {
      if (this.shouldSkipFile(file)) {
        this.log(`Skipping ${file.filename} (${file.status})`);
        continue;
      }

      // Check if file is unchanged and has cached review
      if (file.sha && cachedState) {
        const cachedReview = this.stateCache.getCachedFileReview(
          file.filename,
          file.sha,
          cachedState
        );
        if (cachedReview) {
          this.log(`Using cached review for ${file.filename} (unchanged)`);
          cachedResults.push(cachedReview);
          filesSkipped++;
          continue;
        }
      }

      filesToReview.push(file);
    }

    // If no files to review, return cached results only
    if (filesToReview.length === 0) {
      if (filesSkipped > 0) {
        this.log(`Skipped ${filesSkipped} unchanged file(s) from previous review`);
      }
      return { fileResults: cachedResults, filesSkipped };
    }

    // Use batched review for all files at once
    this.log(`Reviewing ${filesToReview.length} file(s) in batched mode...`);
    const batchedResults = await this.reviewFilesBatched(
      prIdentifier,
      filesToReview,
      existingComments,
      repoPath
    );

    // Combine cached and new results
    const fileResults = [...cachedResults, ...batchedResults];

    if (filesSkipped > 0) {
      this.log(`Skipped ${filesSkipped} unchanged file(s) from previous review`);
    }

    return { fileResults, filesSkipped };
  }

  /**
   * Reviews multiple files in a single batched AI call.
   * Stores diffs to disk and asks the AI to review all files at once.
   * Supports both general and specialist review types.
   */
  private async reviewFilesBatched(
    prIdentifier: string,
    files: PRFile[],
    existingComments: readonly ExistingComment[],
    repoPath?: string
  ): Promise<FileReviewResult[]> {
    const tempPath = this.options.tempPath ?? path.join(process.cwd(), ".mergementor");
    const diffStorage = new DiffStorage(tempPath, this.fileSystem);

    // Filter files with patches
    const filesWithPatches = files.filter((f) => f.patch);
    if (filesWithPatches.length === 0) {
      return files.map((f) => ({ filename: f.filename, findings: [] }));
    }

    // Extract PR number from identifier for audit logging
    const prNumber = parseInt(prIdentifier.split("-PR")[1], 10);
    this.auditLogger.logFileReviewStart(`batched-${filesWithPatches.length}-files`, prNumber);

    const reviewType = this.options.reviewType ?? "general";

    try {
      // Store diffs to disk
      const { diffDir, manifest } = await diffStorage.storeDiffs(prIdentifier, filesWithPatches);
      this.logger.info(
        { prNumber, fileCount: manifest.files.length, diffDir, reviewType },
        "Stored diffs for batched review"
      );

      // Copy diff files to repo's .mergementor directory so AI can access them
      this.logger.debug("Copying diffs to repo's .mergementor directory for AI access");
      await this.copyDiffsToRepoDir(diffDir, manifest, repoPath);

      // Build prompt based on review type
      const commentsContext = formatExistingCommentsContext(existingComments);
      let prompt: string;

      switch (reviewType) {
        case "testing": {
          // Get all changed files for context
          const allChangedFiles = filesWithPatches.map((f) => f.filename);

          // For testing reviews, we need to build context with test file mappings
          // Detect language from the first non-test file
          const productionFiles = allChangedFiles.filter((f) => !isTestFile(f));
          const language: SupportedLanguage =
            productionFiles.length > 0 ? detectLanguage(productionFiles[0]) : "unknown";

          // Find test files for production files
          const testFiles = productionFiles
            .map((f) => findTestFileForProduction(f, allChangedFiles))
            .filter((f): f is string => f !== undefined);

          const context: TestingReviewContext = {
            filename: manifest.files.map((f) => f.filename).join(", "),
            testFiles,
            language,
            allChangedFiles,
          };

          prompt = buildTestingFileReviewPrompt(manifest, context, repoPath);
          this.logger.info(
            {
              language,
              testFilesFound: testFiles.length,
              productionFiles: productionFiles.length,
            },
            "Built testing specialist prompt"
          );
          break;
        }

        case "security":
          prompt = buildSecurityFileReviewPrompt(manifest, repoPath);
          this.logger.info("Built security specialist prompt");
          break;

        case "performance":
          prompt = buildPerformanceFileReviewPrompt(manifest, repoPath);
          this.logger.info("Built performance specialist prompt");
          break;
        default:
          prompt = buildGeneralFileReviewPrompt(manifest, commentsContext || undefined, repoPath);
          this.logger.info("Built general review prompt");
          break;
      }

      // Single AI call for all files
      this.logger.debug(
        {
          promptLength: prompt.length,
          promptPreview: prompt.substring(0, 2000),
          promptSuffix: prompt.substring(Math.max(0, prompt.length - 500)),
          hasRepoPath: !!repoPath,
          reviewType,
        },
        "Batched prompt being sent"
      );

      const streaming = this.createStreamingCallback("Reviewing files...");
      let response: AIResponse;
      try {
        response = await this.provider.executePrompt(prompt, {
          workingDirectory: repoPath,
          onStreamData: streaming.callback,
        });
      } finally {
        streaming.finish();
      }
      const results = this.provider.parseBatchedFileReview(response);

      // Log individual file results
      const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);
      this.log(
        `  Batched review found ${totalFindings} total issues across ${results.length} files`
      );

      for (const result of results) {
        if (result.findings.length > 0) {
          this.log(`    ${result.filename}: ${result.findings.length} issues`);
        }
      }

      this.auditLogger.logFileReviewComplete(
        `batched-${filesWithPatches.length}-files`,
        prNumber,
        totalFindings
      );

      // Ensure we have results for all files (fill in missing ones with empty results)
      const resultMap = new Map(results.map((r) => [r.filename, r]));
      const completeResults: FileReviewResult[] = filesWithPatches.map((file) => {
        return resultMap.get(file.filename) ?? { filename: file.filename, findings: [] };
      });

      return completeResults;
    } catch (error) {
      this.auditLogger.logFileReviewComplete(
        `batched-${filesWithPatches.length}-files`,
        prNumber,
        0,
        "failure",
        (error as Error).message
      );
      throw error;
    } finally {
      // Clean up diffs
      await diffStorage.cleanup(prIdentifier);
    }
  }

  /**
   * Copies diff files to the repo's .mergementor directory so Copilot CLI can access them.
   * If repoPath is not provided, falls back to the global temp directory.
   */
  private async copyDiffsToRepoDir(
    diffDir: string,
    manifest: DiffManifest,
    repoPath?: string
  ): Promise<void> {
    // Use repo's .mergementor/diffs directory if repoPath provided, otherwise global temp
    const targetDir = repoPath
      ? path.join(repoPath, ".mergementor", "diffs")
      : path.join(this.options.tempPath ?? ".mergementor", "temp");

    // Ensure target directory exists
    await this.fileSystem.mkdir(targetDir, { recursive: true });

    this.logger.debug(
      { fileCount: manifest.files.length, targetDir },
      "Copying diff files to accessible directory"
    );

    for (const fileEntry of manifest.files) {
      const sourcePath = path.join(diffDir, fileEntry.diffPath);
      const destPath = path.join(targetDir, fileEntry.diffPath);

      this.logger.debug(
        { diffPath: fileEntry.diffPath, sourcePath, destPath },
        "Copying diff file"
      );

      try {
        const content = await this.fileSystem.readFile(sourcePath, "utf-8");
        await this.fileSystem.writeFile(destPath, content, "utf-8");
        this.logger.debug(
          { diffPath: fileEntry.diffPath, contentLength: content.length },
          "Successfully copied diff file"
        );
      } catch (error) {
        this.logger.warn(
          { diffPath: fileEntry.diffPath, error: (error as Error).message },
          "Failed to copy diff file"
        );
        throw error;
      }
    }
  }

  /**
   * Validates and adjusts line numbers in findings to match actual diff lines.
   * Filters out findings with invalid line numbers that can't be mapped.
   */
  private validateLineNumbers(
    fileResults: FileReviewResult[],
    files: PRFile[]
  ): FileReviewResult[] {
    // Create a map of filename to valid line numbers
    const validLinesMap = new Map<string, Set<number>>();
    for (const file of files) {
      validLinesMap.set(file.filename, getValidDiffLines(file.patch));
    }

    const validatedResults: FileReviewResult[] = [];

    for (const result of fileResults) {
      const validLines = validLinesMap.get(result.filename);
      if (!validLines || validLines.size === 0) {
        this.logger.warn(
          {
            filename: result.filename,
            findingsCount: result.findings.length,
          },
          "No valid diff lines found for file, skipping inline comments"
        );
        continue;
      }

      const validatedFindings = result.findings
        .map((finding) => {
          if (validLines.has(finding.line)) {
            return finding;
          }

          // Try to find nearest valid line
          const nearestLine = findNearestValidLine(finding.line, validLines);
          if (nearestLine !== undefined) {
            this.logger.info(
              {
                filename: result.filename,
                requestedLine: finding.line,
                adjustedLine: nearestLine,
                severity: finding.severity,
                category: finding.category,
              },
              "Adjusted finding line number to nearest valid diff line"
            );

            return {
              ...finding,
              line: nearestLine,
            };
          }

          // No valid line found, log and filter out
          this.logger.warn(
            {
              filename: result.filename,
              invalidLine: finding.line,
              severity: finding.severity,
              category: finding.category,
              message: finding.message.slice(0, 100),
            },
            "Cannot find valid diff line for finding, skipping inline comment"
          );

          return null;
        })
        .filter((f): f is NonNullable<typeof f> => f !== null);

      if (validatedFindings.length > 0 || result.findings.length === 0) {
        // Include files with validated findings OR files with no findings at all
        validatedResults.push({
          filename: result.filename,
          findings: validatedFindings,
        });
      } else if (result.findings.length > 0) {
        this.logger.warn(
          {
            filename: result.filename,
            originalFindingsCount: result.findings.length,
          },
          "All findings filtered out due to invalid line numbers"
        );
      }
    }

    return validatedResults;
  }

  private async performCrossFileAnalysis(
    prDetails: PRDetails,
    files: PRFile[],
    fileResults: readonly FileReviewResult[],
    existingComments: readonly ExistingComment[],
    repoPath?: string
  ): Promise<CrossFileReviewResult> {
    this.log("Performing cross-file analysis...");
    this.auditLogger.logCrossFileReviewStart(prDetails.number, files.length);

    const reviewType = this.options.reviewType ?? "general";

    try {
      const filesSummary = buildFilesSummary(files);
      const commentsContext = formatExistingCommentsContext(existingComments);
      let prompt: string;

      switch (reviewType) {
        case "testing": {
          // Build production-to-test mapping for testing specialist
          const allChangedFiles = files.map((f) => f.filename);
          const productionToTestMap = new Map<string, string | undefined>();

          for (const filename of allChangedFiles) {
            if (!isTestFile(filename)) {
              const testFile = findTestFileForProduction(filename, allChangedFiles);
              productionToTestMap.set(filename, testFile);
            }
          }

          const context: TestingCrossFileContext = {
            fileReviewResults: fileResults,
            productionToTestMap,
            allChangedFiles,
            filesSummary,
          };

          prompt = buildTestingCrossFilePrompt(prDetails, context, repoPath);
          this.logger.info(
            {
              productionFiles: productionToTestMap.size,
              mappedTests: Array.from(productionToTestMap.values()).filter((v) => v).length,
            },
            "Built testing specialist cross-file prompt"
          );
          break;
        }

        case "security": {
          const context: SecurityCrossFileContext = {
            filesSummary,
            fileReviewResults: fileResults,
            existingCommentsContext: commentsContext,
          };

          prompt = buildSecurityCrossFilePrompt(prDetails, context, repoPath);
          this.logger.info("Built security specialist cross-file prompt");
          break;
        }

        case "performance": {
          const context: PerformanceCrossFileContext = {
            filesSummary,
            fileReviewResults: fileResults,
            existingCommentsContext: commentsContext,
          };

          prompt = buildPerformanceCrossFilePrompt(prDetails, context, repoPath);
          this.logger.info("Built performance specialist cross-file prompt");
          break;
        }
        default: {
          const context: GeneralCrossFileContext = {
            filesSummary,
            fileReviewResults: fileResults,
            existingCommentsContext: commentsContext,
          };

          prompt = buildGeneralCrossFilePrompt(prDetails, context, repoPath);
          this.logger.info("Built general cross-file prompt");
          break;
        }
      }

      const streaming = this.createStreamingCallback("Cross-file analysis...");
      let response: AIResponse;
      try {
        response = await this.provider.executePrompt(prompt, {
          workingDirectory: repoPath,
          onStreamData: streaming.callback,
        });
      } finally {
        streaming.finish();
      }
      const result = this.provider.parseCrossFileReview(response);
      this.log(`  Overall: ${result.overallAssessment.slice(0, 100)}...`);

      this.auditLogger.logCrossFileReviewComplete(prDetails.number, result.findings.length);
      return result;
    } catch (error) {
      this.auditLogger.logCrossFileReviewComplete(
        prDetails.number,
        0,
        "failure",
        (error as Error).message
      );
      throw error;
    }
  }

  /**
   * Performs fast review (combined file + cross-file analysis in single pass).
   * This reduces AI calls by combining both passes into one, saving costs.
   */
  private async performFastReview(
    prIdentifier: string,
    prDetails: PRDetails,
    files: PRFile[],
    existingComments: readonly ExistingComment[],
    repoPath?: string
  ): Promise<{ fileResults: FileReviewResult[]; crossFileResult: CrossFileReviewResult }> {
    this.log("Performing fast review (combined file + architectural analysis)...");

    // Extract PR number for audit logging
    const prNumber = parseInt(prIdentifier.split("-PR")[1], 10);
    this.auditLogger.logFileReviewStart("fast-review", prNumber);

    // Filter files with patches
    const filesWithPatches = files.filter((f) => !this.shouldSkipFile(f) && f.patch);
    if (filesWithPatches.length === 0) {
      return {
        fileResults: [],
        crossFileResult: {
          overallAssessment: "No files to review",
          findings: [],
          recommendations: [],
        },
      };
    }

    const tempPath = this.options.tempPath ?? path.join(process.cwd(), ".mergementor");
    const diffStorage = new DiffStorage(tempPath, this.fileSystem);

    try {
      // Store diffs to disk
      const { diffDir, manifest } = await diffStorage.storeDiffs(prIdentifier, filesWithPatches);
      this.logger.info(
        { prNumber, fileCount: manifest.files.length, diffDir },
        "Stored diffs for fast review"
      );

      // Copy diff files to repo's .mergementor directory for AI access
      await this.copyDiffsToRepoDir(diffDir, manifest, repoPath);

      // Build combined prompt for fast review
      const commentsContext = formatExistingCommentsContext(existingComments);
      const { buildFastReviewPrompt } = await import("../ai/prompts/specialists/fast.js");
      const prompt = buildFastReviewPrompt(
        prDetails,
        manifest,
        commentsContext || undefined,
        repoPath
      );

      this.logger.info({ promptLength: prompt.length }, "Built fast review prompt");

      // Single AI call for combined analysis
      const streaming = this.createStreamingCallback("Fast review (file + architecture)...");
      let response: AIResponse;
      try {
        response = await this.provider.executePrompt(prompt, {
          workingDirectory: repoPath,
          onStreamData: streaming.callback,
        });
      } finally {
        streaming.finish();
      }

      // Parse combined response
      const result = this.provider.parseFastReview(response);

      // Log results
      const totalFileFindings = result.fileResults.reduce((sum, r) => sum + r.findings.length, 0);
      const crossFileFindings = result.crossFileResult.findings.length;
      this.log(
        `  Fast review found ${totalFileFindings} file-level issues and ${crossFileFindings} architectural issues`
      );

      for (const fileResult of result.fileResults) {
        if (fileResult.findings.length > 0) {
          this.log(`    ${fileResult.filename}: ${fileResult.findings.length} issues`);
        }
      }

      this.auditLogger.logFileReviewComplete("fast-review", prNumber, totalFileFindings);
      this.auditLogger.logCrossFileReviewComplete(prNumber, crossFileFindings);

      return result;
    } catch (error) {
      this.auditLogger.logFileReviewComplete(
        "fast-review",
        prNumber,
        0,
        "failure",
        (error as Error).message
      );
      throw error;
    }
  }

  private async executeCommentActions(
    prNumber: number,
    actions: CommentAction[]
  ): Promise<{
    commentsCreated: number;
    commentErrors: string[];
  }> {
    let commentsCreated = 0;
    const commentErrors: string[] = [];

    if (!this.options.dryRun) {
      for (const action of actions) {
        try {
          await this.executeAction(prNumber, action);
          if (action.type === "create") commentsCreated++;
        } catch (error) {
          const err = error as Error;
          const errorMsg = `Failed to ${action.type} comment: ${err.message}`;
          this.logger.error(
            {
              prNumber,
              actionType: action.type,
              path: action.path,
              line: action.line,
              commentId: action.existingCommentId,
              error: err.message,
              errorStack: err.stack,
            },
            "Comment action failed"
          );
          this.log(`Warning: ${errorMsg}`);
          commentErrors.push(errorMsg);
        }
      }
    } else {
      this.logDryRunActions(actions);
      commentsCreated = actions.filter((a) => a.type === "create").length;
    }

    return { commentsCreated, commentErrors };
  }

  private async executeAction(prNumber: number, action: CommentAction): Promise<void> {
    this.logger.debug(
      {
        prNumber,
        actionType: action.type,
        path: action.path,
        line: action.line,
        commentId: action.existingCommentId,
      },
      "Executing comment action"
    );

    switch (action.type) {
      case "create":
        if (!action.body) {
          throw new Error("Create action requires body");
        }
        if (action.path && action.line) {
          await this.platform.postInlineComment(prNumber, action.path, action.line, action.body);
          this.logger.info(
            { prNumber, path: action.path, line: action.line },
            "Inline comment created"
          );
        } else {
          await this.platform.postGeneralComment(prNumber, action.body);
          this.logger.info({ prNumber }, "General comment created");
        }
        break;
    }
  }

  private shouldSkipFile(file: PRFile): boolean {
    if (file.status === "deleted") return true;
    if (!file.patch) return true;
    return SKIP_EXTENSIONS.some((ext) => file.filename.endsWith(ext));
  }

  /**
   * Creates synthetic "existing comment" objects from findings to provide context
   * to subsequent review runs in multi-run mode.
   */
  private createSyntheticComments(
    realComments: readonly ExistingComment[],
    findings: readonly FileReviewResult[]
  ): ExistingComment[] {
    const synthetic: ExistingComment[] = [...realComments];
    let syntheticId = -1; // Use negative IDs for synthetic comments

    for (const fileResult of findings) {
      for (const finding of fileResult.findings) {
        // Create a synthetic comment matching our format
        const syntheticBody = this.commentManager.formatInlineComment(finding, fileResult.filename);

        synthetic.push({
          id: syntheticId--,
          body: syntheticBody,
          path: fileResult.filename,
          line: finding.line,
          isResolved: false,
        });
      }
    }

    return synthetic;
  }

  private buildFileShaMap(files: PRFile[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const file of files) {
      if (file.sha) {
        map.set(file.filename, file.sha);
      }
    }
    return map;
  }

  private log(message: string): void {
    if (this.options.verbose !== false) {
      this.output.log(message);
      this.logger.debug(message);
    }
  }

  private logDryRunActions(actions: CommentAction[]): void {
    this.log("\n📝 Dry-run mode - showing planned actions:\n");
    for (const action of actions) {
      this.logDryRunAction(action);
    }
  }

  private logDryRunAction(action: CommentAction): void {
    const separator = "-".repeat(40);

    switch (action.type) {
      case "create":
        if (action.path && action.line) {
          this.log(`[CREATE] Inline comment at ${action.path}:${action.line}`);
        } else {
          this.log("[CREATE] General/Summary comment");
        }
        this.log(separator);
        this.log(action.body || "");
        this.log(`${separator}\n`);
        break;
    }
  }
}
