import { type AIProviderClient, type AIProviderType, createAIProvider } from "../ai/index.js";
import { formatExistingCommentsContext } from "../ai/prompts/commentContext.js";
import {
  buildBatchedFileReviewPrompt,
  buildCrossFilePrompt,
  buildFilesSummary,
} from "../ai/prompts/prompts.js";
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
import { findNearestValidLine, getValidDiffLines } from "../utils/diffParser.js";
import { CommentManager } from "./commentManager.js";
import { type DiffManifest, DiffStorage } from "./diffStorage.js";
import { FindingAggregator } from "./findingAggregator.js";
import { ReviewStateCache } from "./reviewStateCache.js";

/** Result of a complete PR review. */
export interface ReviewResult {
  readonly prDetails: PRDetails;
  readonly filesReviewed: number;
  readonly filesSkipped: number;
  readonly fileResults: readonly FileReviewResult[];
  readonly crossFileResult: CrossFileReviewResult;
  readonly commentsCreated: number;
  readonly commentsUpdated: number;
  readonly commentsResolved: number;
  readonly commentErrors: readonly string[];
}

/** Options for configuring the review engine. */
export interface ReviewEngineOptions {
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
  /** OpenAI API key (required for OpenAI provider) */
  readonly openaiApiKey?: string;
  /** OpenAI base URL (for Azure Foundry compatibility) */
  readonly openaiBaseUrl?: string;
  /** OpenAI max retries */
  readonly openaiMaxRetries?: number;
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
  private readonly options: ReviewEngineOptions;
  private readonly logger = createChildLogger({ component: "ReviewEngine" });
  private readonly auditLogger = getAuditLogger();
  private platformName = "unknown";

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

    // Build provider options - include OpenAI-specific options when applicable
    const providerOptions =
      resolvedProviderType === "openai"
        ? {
            model,
            timeoutMs,
            apiKey: resolvedOptions?.openaiApiKey ?? "",
            baseUrl: resolvedOptions?.openaiBaseUrl,
            maxRetries: resolvedOptions?.openaiMaxRetries,
          }
        : {
            model,
            timeoutMs,
            token: resolvedProviderType === "copilot" ? resolvedOptions?.copilotToken : undefined,
          };

    this.provider = createAIProvider(resolvedProviderType, providerOptions);
    this.commentManager = new CommentManager(botIdentifier, {
      skipPreExisting: resolvedOptions?.skipPreExisting,
    });
    this.stateCache = new ReviewStateCache();
    this.options = resolvedOptions ?? {};
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
      },
      "ReviewEngine initialized"
    );
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
    this.logger.info({ prNumber, prIdentifier, runs }, "Starting PR review");
    this.log(`Starting review of PR #${prNumber}...`);
    this.auditLogger.logReviewStart(prNumber, this.platformName, runs);

    const { prDetails, files } = await this.fetchPRData(prNumber);
    const existingComments = await this.fetchExistingComments(prNumber);
    const cachedState = await this.stateCache.getState(prIdentifier);

    let fileResults: FileReviewResult[];
    let crossFileResult: CrossFileReviewResult;
    let filesSkipped: number;

    if (runs === 1) {
      // Single run - use existing logic
      const reviewData = await this.reviewFiles(prIdentifier, files, existingComments, cachedState);
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
          existingComments
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
        existingComments
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
        commentsUpdated: commentStats.commentsUpdated,
        commentsResolved: commentStats.commentsResolved,
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
      commentStats.commentsUpdated,
      commentStats.commentsResolved,
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
    existingComments: readonly ExistingComment[]
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
        const { fileResults } = await this.reviewFiles(prIdentifier, files, runComments, undefined);
        const validatedResults = this.validateLineNumbers(fileResults, files);
        allFileResults.push(validatedResults);

        // Accumulate findings for next run's context
        accumulatedFindings.push(...validatedResults);

        // Perform cross-file analysis for this run
        const crossFileResult = await this.performCrossFileAnalysis(
          prDetails,
          files,
          validatedResults,
          runComments
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

  private async reviewFiles(
    prIdentifier: string,
    files: PRFile[],
    existingComments: readonly ExistingComment[],
    cachedState?: Awaited<ReturnType<ReviewStateCache["getState"]>>
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
      existingComments
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
   */
  private async reviewFilesBatched(
    prIdentifier: string,
    files: PRFile[],
    existingComments: readonly ExistingComment[]
  ): Promise<FileReviewResult[]> {
    const diffStorage = new DiffStorage();

    // Filter files with patches
    const filesWithPatches = files.filter((f) => f.patch);
    if (filesWithPatches.length === 0) {
      return files.map((f) => ({ filename: f.filename, findings: [] }));
    }

    // Extract PR number from identifier for audit logging
    const prNumber = parseInt(prIdentifier.split("-PR")[1], 10);
    this.auditLogger.logFileReviewStart(`batched-${filesWithPatches.length}-files`, prNumber);

    try {
      // Store diffs to disk
      const { diffDir, manifest } = await diffStorage.storeDiffs(prIdentifier, filesWithPatches);
      this.logger.info(
        { prNumber, fileCount: manifest.files.length, diffDir },
        "Stored diffs for batched review"
      );

      // Build batched prompt
      const commentsContext = formatExistingCommentsContext(existingComments);
      const prompt = buildBatchedFileReviewPrompt(manifest, commentsContext || undefined);

      this.logger.debug("Copying diffs to temp directory for Copilot access");
      // Copy diff files to temp directory so Copilot CLI can access them
      await this.copyDiffsToTempDir(diffDir, manifest);

      // Single AI call for all files
      this.logger.debug(
        {
          promptLength: prompt.length,
          promptPreview: prompt.substring(0, 2000),
          promptSuffix: prompt.substring(Math.max(0, prompt.length - 500)),
        },
        "Batched prompt being sent"
      );

      const response = await this.provider.executePrompt(prompt);
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
   * Copy diff files from storage directory to temp directory for Copilot CLI access
   */
  private async copyDiffsToTempDir(diffDir: string, manifest: DiffManifest): Promise<void> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const tempDir = path.join(process.cwd(), ".merge-mentor", "temp");

    // Ensure temp directory exists
    await fs.mkdir(tempDir, { recursive: true });

    this.logger.debug({ fileCount: manifest.files.length }, "Copying diff files to temp directory");

    for (const fileEntry of manifest.files) {
      const sourcePath = path.join(diffDir, fileEntry.diffPath);
      const destPath = path.join(tempDir, fileEntry.diffPath);

      this.logger.debug(
        { diffPath: fileEntry.diffPath, sourcePath, destPath },
        "Copying diff file"
      );

      try {
        const content = await fs.readFile(sourcePath, "utf-8");
        await fs.writeFile(destPath, content, "utf-8");
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
    existingComments: readonly ExistingComment[]
  ): Promise<CrossFileReviewResult> {
    this.log("Performing cross-file analysis...");
    this.auditLogger.logCrossFileReviewStart(prDetails.number, files.length);

    try {
      const filesSummary = buildFilesSummary(files);
      const commentsContext = formatExistingCommentsContext(existingComments);
      const prompt = buildCrossFilePrompt(prDetails, filesSummary, fileResults, commentsContext);
      const response = await this.provider.executePrompt(prompt);
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

  private async executeCommentActions(
    prNumber: number,
    actions: CommentAction[]
  ): Promise<{
    commentsCreated: number;
    commentsUpdated: number;
    commentsResolved: number;
    commentErrors: string[];
  }> {
    let commentsCreated = 0;
    let commentsUpdated = 0;
    let commentsResolved = 0;
    const commentErrors: string[] = [];

    if (!this.options.dryRun) {
      for (const action of actions) {
        try {
          await this.executeAction(prNumber, action);
          if (action.type === "create") commentsCreated++;
          else if (action.type === "update") commentsUpdated++;
          else if (action.type === "resolve") commentsResolved++;
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
      commentsUpdated = actions.filter((a) => a.type === "update").length;
      commentsResolved = actions.filter((a) => a.type === "resolve").length;
    }

    return { commentsCreated, commentsUpdated, commentsResolved, commentErrors };
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

      case "update":
        if (!action.existingCommentId) {
          throw new Error("Update action requires existingCommentId");
        }
        if (!action.body) {
          throw new Error("Update action requires body");
        }
        await this.platform.updateComment(action.existingCommentId, action.body);
        this.logger.info({ prNumber, commentId: action.existingCommentId }, "Comment updated");
        break;

      case "resolve":
        if (!action.existingCommentId) {
          throw new Error("Resolve action requires existingCommentId");
        }
        await this.platform.resolveComment(action.existingCommentId);
        this.logger.info({ prNumber, commentId: action.existingCommentId }, "Comment resolved");
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
      console.log(message);
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

      case "update":
        this.log(`[UPDATE] Comment ID: ${action.existingCommentId}`);
        if (action.path) {
          this.log(`  File: ${action.path}:${action.line ?? "N/A"}`);
        }
        this.log(separator);
        this.log(action.body || "");
        this.log(`${separator}\n`);
        break;

      case "resolve":
        this.log(`[RESOLVE] Comment ID: ${action.existingCommentId}`);
        this.log("");
        break;
    }
  }
}
