import { SKIP_EXTENSIONS } from "../constants.js";
import { CopilotClient } from "../copilot/client.js";
import {
  buildCrossFilePrompt,
  buildFileReviewPrompt,
  buildFilesSummary,
} from "../copilot/prompts.js";
import { ValidationError } from "../errors/index.js";
import { createChildLogger } from "../logger.js";
import type {
  CommentAction,
  CrossFileReviewResult,
  FileReviewResult,
  PlatformAdapter,
  PRDetails,
  PRFile,
} from "../platforms/types.js";
import { findNearestValidLine, getValidDiffLines } from "../utils/diffParser.js";
import { CommentManager } from "./commentManager.js";
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
  readonly copilotModel?: string;
}

/**
 * Orchestrates the PR review process.
 * Coordinates between platform adapters, Copilot client, and comment management.
 */
export class ReviewEngine {
  private readonly platform: PlatformAdapter;
  private readonly copilot: CopilotClient;
  private readonly commentManager: CommentManager;
  private readonly stateCache: ReviewStateCache;
  private readonly options: ReviewEngineOptions;
  private readonly logger = createChildLogger({ component: "ReviewEngine" });

  constructor(platform: PlatformAdapter, botIdentifier: string, options?: ReviewEngineOptions) {
    this.platform = platform;
    this.copilot = new CopilotClient({ model: options?.copilotModel });
    this.commentManager = new CommentManager(botIdentifier);
    this.stateCache = new ReviewStateCache();
    this.options = options ?? {};
    this.logger.info(
      { copilotModel: options?.copilotModel, dryRun: options?.dryRun },
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
   * const engine = new ReviewEngine(githubAdapter, '[Bot]', { dryRun: true });
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

    this.logger.info({ prNumber }, "Starting PR review");
    this.log(`Starting review of PR #${prNumber}...`);

    const { prDetails, files } = await this.fetchPRData(prNumber);
    const existingComments = await this.fetchExistingComments(prNumber);
    const cachedState = await this.stateCache.getState(prNumber);

    const { fileResults, filesSkipped } = await this.reviewFiles(files, cachedState);

    // Validate line numbers against actual diff content
    const validatedResults = this.validateLineNumbers(fileResults, files);

    // Skip cross-file analysis if all files were cached (no files changed)
    let crossFileResult: CrossFileReviewResult;
    if (filesSkipped > 0 && filesSkipped === fileResults.length && cachedState?.crossFileResult) {
      this.log("All files unchanged - using cached cross-file analysis");
      this.logger.info({ prNumber }, "Reusing cached cross-file analysis");
      crossFileResult = cachedState.crossFileResult;
    } else {
      crossFileResult = await this.performCrossFileAnalysis(prDetails, files, validatedResults);
    }

    const actions = this.commentManager.determineActions(
      existingComments,
      validatedResults,
      crossFileResult
    );

    const commentStats = await this.executeCommentActions(prNumber, actions);

    // Save state for future re-reviews
    const fileShaMap = this.buildFileShaMap(files);
    await this.stateCache.saveState(prNumber, validatedResults, fileShaMap, crossFileResult);

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
        filesReviewed: validatedResults.length,
        filesSkipped,
        totalFindings: validatedResults.reduce((sum, r) => sum + r.findings.length, 0),
        commentsCreated: commentStats.commentsCreated,
        commentsUpdated: commentStats.commentsUpdated,
        commentsResolved: commentStats.commentsResolved,
        commentErrors: commentStats.commentErrors.length,
      },
      "PR review completed"
    );

    return {
      prDetails,
      filesReviewed: validatedResults.length - filesSkipped,
      filesSkipped,
      fileResults: validatedResults,
      crossFileResult,
      ...commentStats,
    };
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
    files: PRFile[],
    cachedState?: Awaited<ReturnType<ReviewStateCache["getState"]>>
  ): Promise<{ fileResults: FileReviewResult[]; filesSkipped: number }> {
    const fileResults: FileReviewResult[] = [];
    const filesContext = buildFilesSummary(files);
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
          fileResults.push(cachedReview);
          filesSkipped++;
          continue;
        }
      }

      this.log(`Reviewing ${file.filename}...`);
      const result = await this.reviewFile(file, filesContext);
      fileResults.push(result);
      this.log(`  Found ${result.findings.length} issues`);
    }

    if (filesSkipped > 0) {
      this.log(`Skipped ${filesSkipped} unchanged file(s) from previous review`);
    }

    return { fileResults, filesSkipped };
  }

  private async reviewFile(file: PRFile, filesContext: string): Promise<FileReviewResult> {
    if (!file.patch) {
      return { filename: file.filename, findings: [] };
    }

    const prompt = buildFileReviewPrompt(file.filename, file.patch, filesContext);
    const response = await this.copilot.executePrompt(prompt);
    return this.copilot.parseFileReview(file.filename, response);
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
    fileResults: readonly FileReviewResult[]
  ): Promise<CrossFileReviewResult> {
    this.log("Performing cross-file analysis...");
    const filesSummary = buildFilesSummary(files);
    const prompt = buildCrossFilePrompt(prDetails, filesSummary, fileResults);
    const response = await this.copilot.executePrompt(prompt);
    const result = this.copilot.parseCrossFileReview(response);
    this.log(`  Overall: ${result.overallAssessment.slice(0, 100)}...`);
    return result;
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
