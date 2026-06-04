/**
 * Core review orchestration engine.
 *
 * The ReviewEngine is the central orchestrator for the code review process, managing:
 * - PR file fetching and diff analysis
 * - AI-driven review (file-by-file and cross-file analysis)
 * - Comment lifecycle management (create/deduplicate/post)
 * - Review result caching to avoid re-reviewing unchanged files
 * - Repository cloning for coding standard extraction
 * - Multiple review runs with aggregated findings
 *
 * Supported review types:
 * - general: Comprehensive code review covering style, logic, and best practices
 * - security: Security vulnerability and threat model analysis
 * - testing: Test coverage, quality, and edge case analysis
 * - performance: Performance bottlenecks, complexity analysis, optimization opportunities
 * - custom: General review prompt constrained to user-selected analysis passes
 *
 * Multiple review runs execute sequentially (with delay) and aggregate findings through
 * fingerprinting to deduplicate across runs. This improves finding diversity and robustness.
 *
 * The engine uses dependency injection for all I/O:
 * - PlatformAdapter: GitHub or Azure DevOps integration
 * - AIProviderClient: Copilot, OpenCode, or other AI models
 * - OutputWriter: Display results to console or CI logs
 * - FileSystem: Read/write operations for cache, diffs, repos
 * - ProcessRunner: Execute git commands for cloning/fetching
 * - Clock: Timestamp generation for audit trails
 *
 * @example
 * ```typescript
 * const engine = new ReviewEngine(githubAdapter, '[Bot]', 'copilot', {
 *   reviewType: 'security',
 *   reviewRuns: 2,
 *   dryRun: false,
 * });
 *
 * const result = await engine.reviewPR(123);
 * console.log(`Found ${result.fileResults.reduce((sum, r) => sum + r.findings.length, 0)} issues`);
 * ```
 *
 * @module
 */

import path from "node:path";
import {
  type AIProviderClient,
  type AIProviderType,
  type AIResponse,
  createAIProvider,
  type TokenUsage,
} from "../ai/index.js";
import { buildFilesSummary } from "../ai/prompts/buildFilesSummary.js";
import { formatExistingCommentsContext } from "../ai/prompts/commentContext.js";
import { buildFastReviewPrompt } from "../ai/prompts/specialists/fast.js";
import {
  buildGeneralCrossFilePrompt,
  buildGeneralFileReviewPrompt,
  type GeneralCrossFileContext,
} from "../ai/prompts/specialists/general.js";
import { getAuditLogger } from "../audit/index.js";
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
import { filterPRFiles, getIgnorePatterns } from "../utils/ignoreFilter.js";
import { detectLanguage } from "../utils/languageDetector.js";
import { parsePRNumber } from "../utils/prIdentifier.js";
import { StreamingDisplay } from "../utils/streamingDisplay.js";
import { findTestFileForProduction, isTestFile } from "../utils/testFileMapper.js";
import { mergeTokenUsage } from "../utils/tokenUsage.js";
import { CommentManager } from "./commentManager.js";
import { type DiffManifest, DiffStorage } from "./diffStorage.js";
import type { GitBackendType } from "./gitClient.js";
import { createGitClient } from "./gitClients/factory.js";
import { RepoManager } from "./repoManager.js";
import {
  type ResolvedReviewProfile,
  type ReviewPass,
  type ReviewStrategy,
  resolveReviewProfile,
  validateReviewStrategy,
  validateReviewType,
} from "./reviewSelection.js";
import { ReviewStateCache } from "./reviewStateCache.js";

/** Threshold size (150 KB) below which all file diffs are attached to the initial AI prompt. */
const ATTACHMENT_SIZE_THRESHOLD_BYTES = 150 * 1024;

/**
 * Complete results from a pull request review.
 *
 * Contains file-by-file findings, cross-file analysis, and comment creation results.
 * Use this to determine if the review succeeded, what issues were found, and what
 * comments were posted.
 */
export interface ReviewResult {
  /** PR details from the platform (number, title, author, etc.) */
  readonly prDetails: PRDetails;
  /** Number of files reviewed (non-ignored, with content changes) */
  readonly filesReviewed: number;
  /** Number of files skipped (no diff, binary files, etc.) */
  readonly filesSkipped: number;
  /** Number of files ignored (match ignore patterns) */
  readonly filesIgnored: number;
  /** List of ignored file paths (for debugging) */
  readonly ignoredFiles: readonly string[];
  /** File-level review results (one per reviewed file, findings per file) */
  readonly fileResults: readonly FileReviewResult[];
  /** Cross-file analysis results (architecture, patterns, testing coverage) */
  readonly crossFileResult: CrossFileReviewResult;
  /** Number of comments successfully posted to the PR */
  readonly commentsCreated: number;
  /** Error messages from failed comment postings (doesn't stop review) */
  readonly commentErrors: readonly string[];
  /** Total lines added across all non-ignored files in this PR. */
  readonly linesAdded: number;
  /** Total lines deleted across all non-ignored files in this PR. */
  readonly linesDeleted: number;
  /** Aggregated token usage across all AI calls in this review */
  readonly tokenUsage?: TokenUsage;
}

/**
 * Configuration options for ReviewEngine.
 *
 * Supports both AI provider selection, performance tuning, and behavioral flags.
 * Includes backward compatibility for legacy copilot-specific options.
 */
interface ReviewEngineOptions {
  /** Enable verbose logging (debug-level events) */
  readonly verbose?: boolean;
  /** Dry run mode: review PR but don't post comments. Useful for testing */
  readonly dryRun?: boolean;
  /** Copilot GitHub token for CLI authentication (copilot/copilot-sdk only) */
  readonly copilotToken?: string;
  /** Model identifier for the AI provider (e.g., "gpt-5.2-codex", "claude-opus") */
  readonly aiModel?: string;
  /** Generic OpenAI-compatible BYOK base URL for AI providers that support it. */
  readonly aiBaseUrl?: string;
  /** Generic BYOK API key for AI providers that support it. */
  readonly aiApiKey?: string;
  /** Timeout in milliseconds for AI provider API calls (default: 30000) */
  readonly aiTimeoutMs?: number;
  /** Skip pre-existing issues introduced before this PR (default: true) */
  readonly skipPreExisting?: boolean;
  /** Legacy review type alias used to resolve the review profile. */
  readonly reviewType?: string;
  /** Ordered additive review passes used to build the resolved review profile. */
  readonly reviewPasses?: readonly ReviewPass[];
  /** Execution strategy used to run the resolved review profile. */
  readonly reviewStrategy?: ReviewStrategy;
  /** Fully resolved review profile. */
  readonly reviewProfile?: ResolvedReviewProfile;
  /** Enable streaming display of AI output (default: true if TTY) */
  readonly streamingEnabled?: boolean;
  /** Maximum lines to display in streaming view (default: 5) */
  readonly streamingLines?: number;
  /** CI mode: output as plain text (non-interactive, for log capture) */
  readonly ciMode?: boolean;
  /** Git backend for repository cloning and fetching. Default: 'cli' (system git binary) */
  readonly gitBackend?: string;
  /** Base path for temporary storage (cache, diffs, repos, logs). Defaults to .mergementor in cwd */
  readonly tempPath?: string;
  /**
   * Path to a pre-checked-out repository (e.g., in CI pipelines).
   * When provided, skips cloning and uses this path for coding standard extraction.
   */
  readonly localWorkspacePath?: string;
  /** Glob patterns for files to skip during review (e.g., ['*.test.ts', 'dist/**']) */
  readonly ignorePatterns?: string[];
  /** Output writer for console output (dependency injection, defaults to consoleOutputWriter) */
  readonly output?: OutputWriter;
  /** File system abstraction for I/O (dependency injection, defaults to nodeFs) */
  readonly fileSystem?: FileSystem;
  /** Enable postComment tool for structured output (via --experimental-tools flag) */
  readonly experimentalTools?: boolean;
}

/**
 * Orchestrates the PR review process.
 *
 * Central coordinator that brings together:
 * 1. **Platform Integration**: Fetches PR details, files, existing comments from GitHub or Azure
 * 2. **AI Analysis**: Sends files to AI provider for review (file-level and cross-file)
 * 3. **Comment Management**: Creates/updates/deduplicates PR comments
 * 4. **State Management**: Caches review state to avoid re-reviewing unchanged files
 * 5. **Repository Management**: Clones repo to extract coding standards
 *
 * Supports multiple review runs with finding aggregation. Each run executes independently,
 * findings are deduped by fingerprint, and recommendations are merged.
 *
 * @example
 * ```typescript
 * // Create engine with GitHub adapter
 * const engine = new ReviewEngine(githubAdapter, '[Bot]', 'copilot', {
 *   reviewType: 'security',
 *   reviewRuns: 2,
 *   dryRun: false,
 * });
 *
 * // Review a pull request
 * const result = await engine.reviewPR(123);
 * if (result.fileResults.length > 0) {
 *   console.log(`Found issues in ${result.fileResults.length} files`);
 * }
 * if (result.commentErrors.length > 0) {
 *   console.error(`Failed to post ${result.commentErrors.length} comments`);
 * }
 * ```
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
  private readonly reviewProfile: ResolvedReviewProfile;
  private readonly logger = createChildLogger({ component: "ReviewEngine" });
  private readonly auditLogger = getAuditLogger();
  private platformName = "unknown";
  private readonly streamingEnabled: boolean;
  private readonly streamingLines: number;

  /**
   * Creates a new ReviewEngine.
   *
   * @param platform - GitHub or Azure DevOps platform adapter
   * @param botIdentifier - Identifier for bot comments (e.g., '[Merge Mentor]')
   * @param providerType - AI provider type ('copilot', 'opencode', 'cursor', etc.)
   * @param options - Configuration options
   *
   * @example
   * ```typescript
   * const engine = new ReviewEngine(githubAdapter, '[Bot]', 'copilot', {
   *   aiModel: 'gpt-5.2-codex',
   *   reviewType: 'security',
   * });
   * ```
   */
  constructor(
    platform: PlatformAdapter,
    botIdentifier: string,
    providerType: AIProviderType,
    options?: ReviewEngineOptions
  ) {
    this.platform = platform;

    const model = options?.aiModel;
    const timeoutMs = options?.aiTimeoutMs;
    const tempPath = options?.tempPath ?? path.join(process.cwd(), ".mergementor");
    this.reviewProfile =
      options?.reviewProfile ??
      resolveReviewProfile({
        reviewType: validateReviewType(options?.reviewType),
        reviewPasses: options?.reviewPasses,
        reviewStrategy: validateReviewStrategy(options?.reviewStrategy),
      });

    this.output = options?.output ?? consoleOutputWriter;
    this.fileSystem = options?.fileSystem ?? nodeFs;

    // Build provider options
    const providerOptions = {
      model,
      timeoutMs,
      token: providerType === "copilot-sdk" ? options?.copilotToken : undefined,
      aiBaseUrl: options?.aiBaseUrl,
      aiApiKey: options?.aiApiKey,
      tempPath,
      output: this.output,
      experimentalTools: options?.experimentalTools,
    };

    this.provider = createAIProvider(providerType, providerOptions);
    this.commentManager = new CommentManager(botIdentifier, {
      skipPreExisting: options?.skipPreExisting,
      reviewType: this.reviewProfile.reviewType,
      reviewPasses: this.reviewProfile.passes,
      reviewStrategy: this.reviewProfile.strategy,
      model: model || (providerType === "copilot-sdk" ? "GitHub Copilot" : "OpenCode"),
    });
    this.stateCache = new ReviewStateCache(tempPath);
    this.repoManager = new RepoManager(
      tempPath,
      { ciMode: options?.ciMode },
      createGitClient((options?.gitBackend ?? "cli") as GitBackendType)
    );
    this.options = options ?? {};
    this.streamingEnabled = options?.streamingEnabled ?? true;
    this.streamingLines = options?.streamingLines ?? 9;
    this.platformName = platform.getPlatformName();
    this.logger.info(
      {
        aiProvider: providerType,
        aiModel: model,
        aiTimeoutMs: timeoutMs,
        dryRun: options?.dryRun,
        skipPreExisting: options?.skipPreExisting,
        reviewType: this.reviewProfile.reviewType,
        reviewPasses: this.reviewProfile.passes,
        reviewStrategy: this.reviewProfile.strategy,
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
      ciMode: this.options.ciMode,
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

    const reviewType = this.reviewProfile.reviewType;
    this.logger.info(
      {
        prNumber,
        prIdentifier,
        reviewType,
        reviewPasses: this.reviewProfile.passes,
        reviewStrategy: this.reviewProfile.strategy,
      },
      "Starting PR review"
    );
    this.log(`Starting review of PR #${prNumber}...`);
    this.auditLogger.logReviewStart(
      prNumber,
      this.platformName,
      reviewType,
      this.reviewProfile.passes,
      this.reviewProfile.strategy
    );

    const { prDetails, files, ignoredFiles } = await this.fetchPRData(prNumber);
    const existingComments = await this.fetchExistingComments(prNumber);
    const cachedState = await this.stateCache.getState(prIdentifier);

    // Use pre-existing workspace (CI checkout) or clone the PR branch for CLI agent access
    const repoPath = await this.resolveWorkspace(prDetails.headBranch);

    const linesAdded = files.reduce((sum, f) => sum + f.additions, 0);
    const linesDeleted = files.reduce((sum, f) => sum + f.deletions, 0);

    let fileResults: FileReviewResult[];
    let crossFileResult: CrossFileReviewResult;
    let filesSkipped: number;
    let filesAnalyzed: number | undefined; // overridden in fast mode to reflect files sent to AI
    let tokenUsage: TokenUsage | undefined;

    const onTokenUsage = (usage: TokenUsage | undefined): void => {
      tokenUsage = mergeTokenUsage(tokenUsage, usage);
      if (usage?.model) {
        this.commentManager.updateModel(usage.model);
      }
    };

    // Check if all files are ignored (but there were files originally)
    if (files.length === 0 && ignoredFiles.length > 0) {
      this.log(
        "\n⚠️  Warning: All changed files are ignored by your patterns. No review will be performed.\n"
      );
      this.logger.warn({ prNumber }, "All changed files ignored");
      return {
        prDetails,
        filesReviewed: 0,
        filesSkipped: 0,
        filesIgnored: ignoredFiles.length,
        ignoredFiles,
        fileResults: [],
        linesAdded: 0,
        linesDeleted: 0,
        crossFileResult: {
          overallAssessment: "No files to review",
          findings: [],
          recommendations: [],
        },
        commentsCreated: 0,
        commentErrors: [],
      };
    }

    // Fast review combines file and cross-file analysis in a single pass
    if (this.reviewProfile.strategy === "fast") {
      this.log("Using fast review mode (single-pass file + architectural analysis)...");
      const fastReviewData = await this.performFastReview(
        prIdentifier,
        prDetails,
        files,
        existingComments,
        repoPath,
        onTokenUsage
      );
      fileResults = fastReviewData.fileResults;
      crossFileResult = fastReviewData.crossFileResult;
      filesSkipped = 0; // Fast review doesn't use caching yet
      filesAnalyzed = fastReviewData.filesAnalyzed;

      // Validate line numbers against actual diff content
      fileResults = this.validateLineNumbers(fileResults, files);
    } else {
      const reviewData = await this.reviewFiles(
        prIdentifier,
        files,
        existingComments,
        cachedState,
        repoPath,
        onTokenUsage
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
          repoPath,
          onTokenUsage
        );
      }
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
        filesReviewed: (filesAnalyzed ?? fileResults.length) - filesSkipped,
        filesSkipped,
        totalFindings: fileResults.reduce((sum, r) => sum + r.findings.length, 0),
        commentsCreated: commentStats.commentsCreated,
        commentErrors: commentStats.commentErrors.length,
        tokenUsage,
      },
      "PR review completed"
    );

    this.auditLogger.logReviewComplete(
      prNumber,
      this.platformName,
      (filesAnalyzed ?? fileResults.length) - filesSkipped,
      filesSkipped,
      commentStats.commentsCreated,
      commentStats.commentErrors.length
    );

    return {
      prDetails,
      filesReviewed: (filesAnalyzed ?? fileResults.length) - filesSkipped,
      filesSkipped,
      filesIgnored: ignoredFiles.length,
      ignoredFiles,
      fileResults,
      linesAdded,
      linesDeleted,
      crossFileResult,
      ...commentStats,
      tokenUsage,
    };
  }

  private async fetchPRData(prNumber: number): Promise<{
    prDetails: PRDetails;
    files: PRFile[];
    ignoredFiles: string[];
  }> {
    this.log("Fetching PR details...");
    this.logger.debug({ prNumber }, "Fetching PR data");
    const prDetails = await this.platform.getPRDetails(prNumber);
    const allFiles = await this.platform.getPRFiles(prNumber);

    // Filter files based on ignore patterns
    const ignorePatterns = getIgnorePatterns(this.options.ignorePatterns);
    const { kept: files, ignored: ignoredFiles } = filterPRFiles(allFiles, ignorePatterns);

    if (ignoredFiles.length > 0) {
      this.log(`Ignoring ${ignoredFiles.length} file(s):`);
      ignoredFiles.forEach((file) => {
        this.log(`  - ${file}`);
      });
    }

    this.logger.info(
      {
        prNumber,
        totalFiles: allFiles.length,
        ignoredFiles: ignoredFiles.length,
        keptFiles: files.length,
        title: prDetails.title,
        author: prDetails.author,
      },
      "PR data fetched"
    );
    this.log(
      `Found ${files.length} changed files (${allFiles.length} total, ${ignoredFiles.length} ignored)`
    );
    return { prDetails, files, ignoredFiles };
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

  private hasReviewPass(pass: ReviewPass): boolean {
    return this.reviewProfile.passes.includes(pass);
  }

  private formatContextList(label: string, values: readonly string[]): string {
    if (values.length === 0) {
      return `- ${label}: none`;
    }

    return `- ${label}: ${values.join(", ")}`;
  }

  private buildAdditionalPassContextSections(filenames: readonly string[]): readonly string[] {
    const sections: string[] = [];

    if (this.hasReviewPass("testing")) {
      sections.push(this.buildTestingPassContextSection(filenames));
    }

    if (this.hasReviewPass("database")) {
      sections.push(this.buildDatabasePassContextSection(filenames));
    }

    return sections;
  }

  private buildTestingPassContextSection(filenames: readonly string[]): string {
    const productionFiles = filenames.filter((filename) => !isTestFile(filename));
    const language = productionFiles.length > 0 ? detectLanguage(productionFiles[0]) : "unknown";
    const mappedTests = productionFiles
      .map((productionFile) => ({
        productionFile,
        testFile: findTestFileForProduction(productionFile, filenames),
      }))
      .filter((entry) => entry.testFile !== undefined)
      .map((entry) => `${entry.productionFile} -> ${entry.testFile}`);
    const missingTests = productionFiles.filter(
      (productionFile) => !findTestFileForProduction(productionFile, filenames)
    );
    const changedTestFiles = filenames.filter((filename) => isTestFile(filename));

    return `# TESTING PASS CONTEXT
- Detected language: ${language}
${this.formatContextList("Changed production files", productionFiles)}
${this.formatContextList("Changed test files", changedTestFiles)}
${this.formatContextList("Mapped production-to-test pairs", mappedTests)}
${this.formatContextList("Production files without nearby tests", missingTests)}

During the testing pass, look more carefully for missing coverage, weak assertions, brittle tests, and testability problems while still reporting any material baseline findings.`;
  }

  private buildDatabasePassContextSection(filenames: readonly string[]): string {
    const schemaFiles = filenames.filter((filename) =>
      /(^|\/)(schema|schemas|migrations?|seed|seeds|prisma)\/|schema\.(prisma|sql)$|migration/i.test(
        filename
      )
    );
    const queryFiles = filenames.filter((filename) =>
      /(repository|repositories|dao|model|models|query|queries|typeorm|sequelize|drizzle|knex|db)/i.test(
        filename
      )
    );
    const suspectedDatabaseFiles = filenames.filter((filename) =>
      this.isLikelyDatabaseFile(filename)
    );

    return `# DATABASE PASS CONTEXT
${this.formatContextList("Schema or migration files", schemaFiles)}
${this.formatContextList("Query/model/repository files", queryFiles)}
${this.formatContextList("Suspected database-related files", suspectedDatabaseFiles)}

During the database pass, pay extra attention to query correctness, transaction boundaries, migration safety, nullability, indexing, batching, locking, caching, and data consistency while still reporting any material baseline findings.`;
  }

  private isLikelyDatabaseFile(filename: string): boolean {
    return (
      /(^|\/)(db|database|persistence|storage)\//i.test(filename) ||
      /(repository|repositories|dao|model|models|query|queries|migration|schema|prisma|typeorm|sequelize|drizzle|knex)/i.test(
        filename
      ) ||
      /\.(sql|prisma)$/.test(filename)
    );
  }

  private async reviewFiles(
    prIdentifier: string,
    files: PRFile[],
    existingComments: readonly ExistingComment[],
    cachedState?: Awaited<ReturnType<ReviewStateCache["getState"]>>,
    repoPath?: string,
    onTokenUsage?: (usage: TokenUsage | undefined) => void
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
      repoPath,
      onTokenUsage
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
    repoPath?: string,
    onTokenUsage?: (usage: TokenUsage | undefined) => void
  ): Promise<FileReviewResult[]> {
    const tempPath = this.options.tempPath ?? path.join(process.cwd(), ".mergementor");
    const diffStorage = new DiffStorage(tempPath, this.fileSystem);

    // Filter files with patches
    const filesWithPatches = files.filter((f) => f.patch);
    if (filesWithPatches.length === 0) {
      return files.map((f) => ({ filename: f.filename, findings: [] }));
    }

    const prNumber = parsePRNumber(prIdentifier);
    this.auditLogger.logFileReviewStart(`batched-${filesWithPatches.length}-files`, prNumber);

    try {
      // Store diffs to disk
      const { diffDir, manifest } = await diffStorage.storeDiffs(prIdentifier, filesWithPatches);
      this.logger.info(
        {
          prNumber,
          fileCount: manifest.files.length,
          diffDir,
          reviewType: this.reviewProfile.reviewType,
          reviewPasses: this.reviewProfile.passes,
        },
        "Stored diffs for batched review"
      );

      // Copy diff files to repo's .mergementor directory so AI can access them
      this.logger.debug("Copying diffs to repo's .mergementor directory for AI access");
      const { paths: diffFiles, totalSize } = await this.copyDiffsToRepoDir(
        diffDir,
        manifest,
        repoPath
      );

      // Build prompt from the resolved baseline + additive pass profile
      const commentsContext = formatExistingCommentsContext(existingComments);
      const prompt = buildGeneralFileReviewPrompt(
        manifest,
        commentsContext || undefined,
        repoPath,
        this.reviewProfile.passes,
        this.buildAdditionalPassContextSections(filesWithPatches.map((file) => file.filename))
      );
      this.logger.info(
        {
          reviewPasses: this.reviewProfile.passes,
          reviewType: this.reviewProfile.reviewType,
        },
        "Built resolved file review prompt"
      );

      // Single AI call for all files
      const shouldAttach = totalSize <= ATTACHMENT_SIZE_THRESHOLD_BYTES;
      this.logger.debug(
        {
          promptLength: prompt.length,
          promptPreview: prompt.substring(0, 2000),
          promptSuffix: prompt.substring(Math.max(0, prompt.length - 500)),
          hasRepoPath: !!repoPath,
          reviewType: this.reviewProfile.reviewType,
          reviewPasses: this.reviewProfile.passes,
          totalSize,
          shouldAttach,
        },
        "Batched prompt being sent"
      );

      const streaming = this.createStreamingCallback("Reviewing files...");
      let response: AIResponse;
      try {
        response = await this.provider.executePrompt(prompt, {
          workingDirectory: repoPath,
          onStreamData: streaming.callback,
          ...(shouldAttach ? { diffFiles } : {}),
        });
      } finally {
        streaming.finish();
      }
      onTokenUsage?.(response.tokenUsage);
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
        return (
          resultMap.get(file.filename) ?? {
            filename: file.filename,
            findings: [],
          }
        );
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
  ): Promise<{ paths: string[]; totalSize: number }> {
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

    const paths: string[] = [];
    let totalSize = 0;

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
        paths.push(destPath);
        totalSize += content.length;
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

    return { paths, totalSize };
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
    repoPath?: string,
    onTokenUsage?: (usage: TokenUsage | undefined) => void
  ): Promise<CrossFileReviewResult> {
    this.log("Performing cross-file analysis...");
    this.auditLogger.logCrossFileReviewStart(prDetails.number, files.length);

    try {
      const filesSummary = buildFilesSummary(files);
      const commentsContext = formatExistingCommentsContext(existingComments);
      const context: GeneralCrossFileContext = {
        filesSummary,
        fileReviewResults: fileResults,
        existingCommentsContext: commentsContext,
      };

      const prompt = buildGeneralCrossFilePrompt(
        prDetails,
        context,
        repoPath,
        this.reviewProfile.passes,
        this.buildAdditionalPassContextSections(files.map((file) => file.filename))
      );
      this.logger.info(
        {
          reviewPasses: this.reviewProfile.passes,
          reviewType: this.reviewProfile.reviewType,
        },
        "Built resolved cross-file prompt"
      );

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
      onTokenUsage?.(response.tokenUsage);
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
    repoPath?: string,
    onTokenUsage?: (usage: TokenUsage | undefined) => void
  ): Promise<{
    fileResults: FileReviewResult[];
    crossFileResult: CrossFileReviewResult;
    filesAnalyzed: number;
  }> {
    this.log("Performing fast review (combined file + architectural analysis)...");

    const prNumber = parsePRNumber(prIdentifier);
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
        filesAnalyzed: 0,
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
      const { paths: diffFiles, totalSize } = await this.copyDiffsToRepoDir(
        diffDir,
        manifest,
        repoPath
      );

      // Build combined prompt for fast review
      const commentsContext = formatExistingCommentsContext(existingComments);
      const prompt = buildFastReviewPrompt(
        prDetails,
        manifest,
        commentsContext || undefined,
        repoPath,
        this.reviewProfile.passes,
        this.buildAdditionalPassContextSections(filesWithPatches.map((file) => file.filename))
      );

      this.logger.info({ promptLength: prompt.length }, "Built fast review prompt");

      // Single AI call for combined analysis
      const shouldAttach = totalSize <= ATTACHMENT_SIZE_THRESHOLD_BYTES;
      this.logger.info(
        { totalSize, shouldAttach, threshold: ATTACHMENT_SIZE_THRESHOLD_BYTES },
        "Evaluated diff size for fast review attachments"
      );

      const streaming = this.createStreamingCallback("Fast review (file + architecture)...");
      let response: AIResponse;
      try {
        response = await this.provider.executePrompt(prompt, {
          workingDirectory: repoPath,
          onStreamData: streaming.callback,
          ...(shouldAttach ? { diffFiles } : {}),
        });
      } finally {
        streaming.finish();
      }
      onTokenUsage?.(response.tokenUsage);

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

      return { ...result, filesAnalyzed: filesWithPatches.length };
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
      default: {
        const _exhaustive: never = action.type;
        throw new Error(`Unknown comment action type: ${_exhaustive}`);
      }
    }
  }

  private shouldSkipFile(file: PRFile): boolean {
    if (file.status === "deleted") return true;
    return !file.patch;
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
