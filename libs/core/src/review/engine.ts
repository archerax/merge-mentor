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
 * Supported review strategies:
 * - fast: Single-pass combined file and cross-file analysis
 * - deep: Separate file-by-file and cross-file analysis passes
 * - multi-agent: Specialized subagents coordinated by a lead synthesizer
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

import type { Platform } from "@merge-mentor/config/config.js";
import type { GitBackendType } from "@merge-mentor/config/config.js";
import {
  type ResolvedReviewProfile,
  type ReviewPass,
  type ReviewStrategy,
  resolveReviewProfile,
  validateReviewStrategy,
} from "@merge-mentor/config/reviewSelection.js";
import type {
  CommentAction,
  CrossFileReviewResult,
  ExistingComment,
  FileReviewResult,
  PlatformAdapter,
  PRDetails,
  PRFile,
} from "@merge-mentor/domain/platform.js";
import { getAuditLogger } from "@merge-mentor/shared/audit/index.js";
import { APP_NAME_LINK } from "@merge-mentor/shared/constants.js";
import { ValidationError } from "@merge-mentor/shared/errors/index.js";
import { createChildLogger } from "@merge-mentor/shared/logger.js";
import {
  consoleOutputWriter,
  type FileSystem,
  nodeFs,
  type OutputWriter,
} from "@merge-mentor/shared/ports/index.js";
import { filterPRFiles, getIgnorePatterns } from "@merge-mentor/shared/utils/ignoreFilter.js";
import {
  generatePRIdentifier,
  parsePRNumberSafe,
  sanitizeProjectName,
} from "@merge-mentor/shared/utils/prIdentifier.js";
import { StreamingDisplay } from "@merge-mentor/shared/utils/streamingDisplay.js";
import { mergeTokenUsage } from "@merge-mentor/shared/utils/tokenUsage.js";

import {
  type AIProviderClient,
  type AIProviderType,
  type AIResponse,
  createAIProvider,
  type ReasoningEffort,
  type TokenUsage,
} from "../ai/index.js";
import { buildFilesSummary } from "../ai/prompts/buildFilesSummary.js";
import { formatExistingCommentsContext } from "../ai/prompts/commentContext.js";
import { buildDescribePrompt, buildSuggestTitlePrompt } from "../ai/prompts/describe.js";
import { buildFastReviewPrompt } from "../ai/prompts/specialists/fast.js";
import {
  buildGeneralCrossFilePrompt,
  buildGeneralFileReviewPrompt,
  type GeneralCrossFileContext,
} from "../ai/prompts/specialists/general.js";
import type { FastReviewResult } from "../ai/types.js";
import {
  DEFAULT_BATCH_MAX_BYTES,
  DEFAULT_BATCH_MAX_FILES,
  planReviewBatches,
  runWithConcurrency,
} from "./batching.js";
import { CommentManager } from "./commentManager.js";
import { DiffStorage } from "./diffStorage.js";
import { createGitClient } from "./gitClients/factory.js";
import { LineNumberValidator } from "./lineNumberValidator.js";
import { MultiAgentOrchestrator } from "./multiAgent/orchestrator.js";
import { PbiVerifier } from "./pbiVerifier.js";
import {
  type ProgressStatus,
  type ReviewPhaseId,
  type ReviewProgressCallback,
  type ReviewProgressEvent,
} from "./progress.js";
import { RepoManager } from "./repoManager.js";
import { ReviewStateCache } from "./reviewStateCache.js";
import { WorkspaceManager } from "./workspaceManager.js";

/** Threshold size (150 KB) below which all file diffs are attached to the initial AI prompt. */
const ATTACHMENT_SIZE_THRESHOLD_BYTES = 150 * 1024;

/**
 * Normalizes a repository path reported by the model so it can be compared
 * against manifest filenames, stripping leading "./", separators, and
 * normalizing Windows-style backslashes to forward slashes.
 */
function normalizeRepoPath(filePath: string): string {
  return filePath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

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
  /**
   * Comments a dry-run planned to post, in the order they would be created.
   *
   * Empty when comments were actually posted or when no comments were planned.
   * The web UI round-trips these back to a stateless endpoint to post later.
   */
  readonly plannedComments?: readonly CommentAction[];
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
  /** Ordered additive review passes; only valid with the multi-agent strategy. */
  readonly reviewPasses?: readonly ReviewPass[];
  /** Execution strategy used to run the resolved review profile. */
  readonly reviewStrategy?: ReviewStrategy;
  /** Fully resolved review profile. */
  readonly reviewProfile?: ResolvedReviewProfile;
  /** Enable streaming display of AI output (default: true if TTY) */
  readonly streamingEnabled?: boolean;
  /** Maximum lines to display in streaming view (default: 5) */
  readonly streamingLines?: number;
  /**
   * Optional callback invoked with each raw AI output chunk as it streams in.
   *
   * Unlike {@link streamingEnabled} (which renders a rolling terminal display),
   * this is intended for non-terminal consumers such as the web UI. It receives
   * chunks even when `streamingEnabled` is disabled.
   */
  readonly onStreamChunk?: (chunk: string) => void;
  /**
   * Optional callback invoked with structured progress events (phases, steps,
   * activity) as the review runs. Intended for non-terminal consumers such as
   * the web UI; the CLI leaves it unset and continues to rely on
   * {@link onStreamChunk} and console output.
   */
  readonly onProgress?: ReviewProgressCallback;
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
  /** Pin the session to the long-context tier when the selected model supports it. */
  readonly longContext?: boolean;
  /** Reasoning effort level for models that support it. */
  readonly reasoningEffort?: ReasoningEffort;
  /** Verify pull request changes against linked Product Backlog Items/Issues */
  readonly verifyPbi?: boolean;
  /** Skip reading/writing the per-file SHA review cache (default: false). */
  readonly noCache?: boolean;
  /** Re-review all files, ignoring cached results (default: false). Fresh cache is still written afterward. */
  readonly reReview?: boolean;
  /** Maximum concurrent subagents for the multi-agent strategy (default: 2). */
  readonly multiAgentMaxParallel?: number;
  /** Estimated byte budget for the diffs of one fast-review batch (default: 100 KB). */
  readonly batchMaxBytes?: number;
  /** Maximum number of files in one fast-review batch (default: 15). */
  readonly batchMaxFiles?: number;
  /** Maximum fast-review batches run concurrently (default: 3; 1 while streaming is displayed). */
  readonly batchMaxParallel?: number;
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
export interface DescribePrOptions {
  /** PR number to generate the description for. */
  readonly prNumber: number;
  /** Whether to also generate and return a suggested PR title. */
  readonly suggestTitle?: boolean;
  /** Whether to push the generated title/body back to the platform. */
  readonly write?: boolean;
  /** Whether to stream AI output live while generating (default: true). */
  readonly streamingEnabled?: boolean;
}

/**
 * Main PR review orchestrator.
 *
 * Coordinates the full review lifecycle: fetching PR data from the platform,
 * running the resolved review profile (per-file review, cross-file analysis,
 * fast or multi-agent strategies), validating finding line numbers, posting or
 * updating PR comments, and caching review state. Depends on injected
 * platform, AI provider, filesystem, and output abstractions.
 *
 * @example
 * ```typescript
 * const engine = new ReviewEngine(githubAdapter, '[Bot]', 'copilot', {
 *   dryRun: false,
 * });
 * const result = await engine.reviewPR(123);
 * ```
 */
export class ReviewEngine {
  private readonly platform: PlatformAdapter;
  private readonly provider: AIProviderClient;
  private readonly commentManager: CommentManager;
  private readonly stateCache: ReviewStateCache;
  private readonly repoManager: RepoManager;
  private readonly workspaceManager: WorkspaceManager;
  private readonly pbiVerifier: PbiVerifier;
  private readonly lineNumberValidator: LineNumberValidator;
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
   * @param providerType - AI provider type ('copilot-sdk' or 'opencode-sdk')
   * @param options - Configuration options
   *
   * @example
   * ```typescript
   * const engine = new ReviewEngine(githubAdapter, '[Bot]', 'copilot', {
   *   aiModel: 'gpt-5.2-codex',
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
      longContext: options?.longContext,
      reasoningEffort: options?.reasoningEffort,
    };

    this.provider = createAIProvider(providerType, providerOptions);
    this.commentManager = new CommentManager(botIdentifier, {
      skipPreExisting: options?.skipPreExisting,
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
    this.workspaceManager = new WorkspaceManager(
      platform,
      this.repoManager,
      this.fileSystem,
      this.output,
      {
        tempPath,
        localWorkspacePath: options?.localWorkspacePath,
        verbose: options?.verbose,
        ciMode: options?.ciMode,
      }
    );
    this.pbiVerifier = new PbiVerifier(platform, this.provider, this.output, {
      verbose: options?.verbose,
    });
    this.lineNumberValidator = new LineNumberValidator();
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
        reviewPasses: this.reviewProfile.passes,
        reviewStrategy: this.reviewProfile.strategy,
      },
      "ReviewEngine initialized"
    );
  }

  /**
   * Emits a phase transition event when an `onProgress` consumer is attached.
   * A no-op for the CLI, which does not subscribe to progress events.
   */
  private phase(id: ReviewPhaseId, label: string, status: ProgressStatus): void {
    this.options.onProgress?.({ kind: "phase", id, label, status });
  }

  /** Emits a progress event, tolerating engines created without a callback. */
  private progress(event: ReviewProgressEvent): void {
    this.options.onProgress?.(event);
  }

  /**
   * Runs `fn` inside a named phase, emitting start/done/error transitions.
   */
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

  /**
   * Creates a streaming display and returns a callback for streaming data.
   *
   * When `phase` is supplied, token deltas are also emitted as structured
   * `stream` progress events so the web UI can render formatted markdown per
   * phase. Returns undefined callback if streaming is disabled.
   */
  private createStreamingCallback(
    context: string,
    phase?: ReviewPhaseId
  ): {
    callback: ((chunk: string) => void) | undefined;
    finish: () => void;
  } {
    const onStreamChunk = this.options.onStreamChunk;
    const hasProgress = phase !== undefined && this.options.onProgress !== undefined;
    if (!this.streamingEnabled && !onStreamChunk && !hasProgress) {
      return { callback: undefined, finish: () => {} };
    }

    const display = this.streamingEnabled
      ? new StreamingDisplay({
          maxLines: this.streamingLines,
          title: `🤖 ${context}`,
          enabled: true,
          ciMode: this.options.ciMode,
          output: this.output,
        })
      : undefined;

    return {
      callback: (chunk: string) => {
        onStreamChunk?.(chunk);
        if (phase !== undefined) {
          this.progress({ kind: "stream", phase, delta: chunk });
        }
        display?.push(chunk);
      },
      finish: () => display?.finish(),
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
  /**
   * Generates a description and summary for a pull request, suggesting a title if requested.
   *
   * @param options - Options containing PR number, suggestTitle flag, write flag, and streaming flag
   * @returns Generated title and body description
   */
  async describePR(options: DescribePrOptions): Promise<{ title?: string; body: string }> {
    const prNumber = options.prNumber;
    if (prNumber <= 0 || !Number.isInteger(prNumber)) {
      this.logger.error({ prNumber }, "Invalid PR number");
      throw new ValidationError("prNumber", "Must be a positive integer");
    }

    const auditLogger = getAuditLogger();
    auditLogger.logDescribeStart(prNumber, this.platformName);
    this.log(`Analyzing diff to generate description for PR #${prNumber}...`);

    const { files } = await this.fetchPRData(prNumber);

    // If there are no file changes or all are ignored, exit early with warning
    if (files.length === 0) {
      this.log(
        "⚠️ No code changes detected or all changes are ignored. Exiting description generation."
      );
      auditLogger.logDescribeComplete(prNumber, this.platformName, "success");
      return {
        body: "No changes detected.",
      };
    }

    // Concatenate diff
    const prDiff = files
      .filter((f) => f.patch)
      .map((f) => `--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}`)
      .join("\n");

    if (!prDiff.trim()) {
      this.log("⚠️ The diff content is empty. Exiting description generation.");
      auditLogger.logDescribeComplete(prNumber, this.platformName, "success");
      return {
        body: "No changes detected.",
      };
    }

    // 1. Generate description body
    const describePrompt = buildDescribePrompt(prDiff);

    let streamingCallback: ((chunk: string) => void) | undefined;
    let finishStreaming: (() => void) | undefined;

    if (options.streamingEnabled) {
      const stream = this.createStreamingCallback("Generating PR Description");
      streamingCallback = stream.callback;
      finishStreaming = stream.finish;
    }

    const bodyResponse = await this.provider.executePrompt(describePrompt, {
      onStreamData: streamingCallback,
      promptType: "cross-file-review",
    });
    finishStreaming?.();

    let body = bodyResponse.raw.trim();

    // Append standard bot signature footer
    body += `\n\n---\n*Generated by ${APP_NAME_LINK}*`;

    // 2. Suggest Title (if requested)
    let title: string | undefined;
    if (options.suggestTitle) {
      this.log("Generating suggested PR title...");
      const titlePrompt = buildSuggestTitlePrompt(prDiff);
      const titleResponse = await this.provider.executePrompt(titlePrompt);
      title = titleResponse.raw.trim();
    }

    // 3. Write to Remote (if requested)
    if (options.write) {
      this.log(`Updating PR details on ${this.platformName}...`);
      await this.platform.updatePRDetails(prNumber, { title, body });
      this.log("✓ PR details updated successfully.");
    }

    auditLogger.logDescribeComplete(prNumber, this.platformName, "success");
    return { title, body };
  }

  /**
   * Reviews a pull request end to end and posts or updates comments.
   *
   * Fetches PR details and files, resolves the repository workspace, and runs
   * the full review pipeline for the configured profile. Findings are posted
   * as PR comments (unless in dry-run mode) and the per-file review state is
   * cached for subsequent runs.
   *
   * @param prNumber - The pull request number to review.
   * @returns Complete review results including findings and comment stats.
   * @throws {ValidationError} When prNumber is not a positive integer.
   */
  async reviewPR(prNumber: number): Promise<ReviewResult> {
    if (prNumber <= 0 || !Number.isInteger(prNumber)) {
      this.logger.error({ prNumber }, "Invalid PR number");
      throw new ValidationError("prNumber", "Must be a positive integer");
    }

    // Generate unique PR identifier. Sanitize the project identifier first:
    // Azure DevOps returns "org/project/repo", whose slashes would otherwise
    // turn cache and diff paths into nested directories and silently break
    // review-state persistence.
    this.phase("resolve", "Resolving review target", "start");
    const projectId = sanitizeProjectName(this.platform.getProjectIdentifier());
    const prIdentifier = generatePRIdentifier(this.platformName as Platform, projectId, prNumber);

    this.logger.info(
      {
        prNumber,
        prIdentifier,
        reviewPasses: this.reviewProfile.passes,
        reviewStrategy: this.reviewProfile.strategy,
      },
      "Starting PR review"
    );
    this.log(`Starting review of PR #${prNumber}...`);
    this.auditLogger.logReviewStart(
      prNumber,
      this.platformName,
      this.reviewProfile.passes,
      this.reviewProfile.strategy
    );
    this.phase("resolve", "Resolving review target", "done");

    const { prDetails, files, ignoredFiles, existingComments } = await this.runPhase(
      "fetch",
      "Fetching PR data",
      async () => {
        const fetched = await this.fetchPRData(prNumber);
        const comments = await this.fetchExistingComments(prNumber);
        return { ...fetched, existingComments: comments };
      }
    );

    const cachedState =
      this.options.noCache || this.options.reReview
        ? undefined
        : await this.stateCache.getState(prIdentifier);

    // Use pre-existing workspace (CI checkout) or clone the PR branch for CLI agent access
    const repoPath = await this.runPhase("workspace", "Preparing workspace", () =>
      this.workspaceManager.resolveWorkspace(prDetails.headBranch)
    );

    return this.runReviewPipeline({
      prIdentifier,
      prDetails,
      files,
      ignoredFiles,
      existingComments,
      cachedState,
      repoPath,
      postComments: true,
      saveState: !this.options.noCache,
    });
  }

  /**
   * Reviews the local working tree (or a ref pair) via a `LocalPlatformAdapter`.
   *
   * Reuses the same review pipeline as `reviewPR`, but no comments are posted —
   * findings are only reported to the user — and the cache key is scoped to the
   * local repository and branch.
   *
   * @param prDetails - Pseudo-PR details synthesized from the local git state.
   * @param files     - Files derived from the local diff.
   */
  async reviewLocal(prDetails: PRDetails, files: PRFile[]): Promise<ReviewResult> {
    this.phase("resolve", "Resolving review target", "start");
    const projectId = sanitizeProjectName(this.platform.getProjectIdentifier());
    const branchId = sanitizeProjectName(prDetails.headBranch);
    const prIdentifier = `Local-${projectId}-${branchId}`;

    this.logger.info(
      { prIdentifier, branch: prDetails.headBranch, base: prDetails.baseBranch },
      "Starting local review"
    );
    this.log(`Starting local review of ${prDetails.headBranch} → ${prDetails.baseBranch}...`);
    this.phase("resolve", "Resolving review target", "done");

    const ignorePatterns = getIgnorePatterns(this.options.ignorePatterns);
    const { kept, ignored } = filterPRFiles(files, ignorePatterns);

    if (ignored.length > 0) {
      this.log(`Ignoring ${ignored.length} file(s):`);
      ignored.forEach((file) => {
        this.log(`  - ${file}`);
      });
    }

    const existingComments: ExistingComment[] = [];
    const cachedState =
      this.options.noCache || this.options.reReview
        ? undefined
        : await this.stateCache.getState(prIdentifier);

    // Use the local checkout directly for CLI agent access (never clones).
    const repoPath = await this.runPhase("workspace", "Preparing workspace", () =>
      this.workspaceManager.resolveWorkspace(prDetails.headBranch)
    );

    return this.runReviewPipeline({
      prIdentifier,
      prDetails,
      files: kept,
      ignoredFiles: ignored,
      existingComments,
      cachedState,
      repoPath,
      postComments: false,
      saveState: !this.options.noCache,
    });
  }

  /**
   * Executes the shared review pipeline: per-file review, cross-file analysis,
   * optional comment posting, and state caching.
   */
  private async runReviewPipeline(params: {
    readonly prIdentifier: string;
    readonly prDetails: PRDetails;
    readonly files: PRFile[];
    readonly ignoredFiles: readonly string[];
    readonly existingComments: readonly ExistingComment[];
    readonly cachedState?: Awaited<ReturnType<ReviewStateCache["getState"]>>;
    readonly repoPath?: string;
    readonly postComments: boolean;
    readonly saveState: boolean;
  }): Promise<ReviewResult> {
    const {
      prIdentifier,
      prDetails,
      files,
      ignoredFiles,
      existingComments,
      cachedState,
      repoPath,
      postComments,
      saveState,
    } = params;

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
      this.logger.warn({ prIdentifier }, "All changed files ignored");
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
    this.phase("file-review", "Reviewing files", "start");
    let fileReviewComplete = false;
    try {
      if (this.reviewProfile.strategy === "fast") {
        this.log("Using fast review mode (single-pass file + architectural analysis)...");
        const fastReviewData = await this.performFastReview(
          prIdentifier,
          prDetails,
          files,
          existingComments,
          cachedState,
          repoPath,
          onTokenUsage
        );
        fileResults = fastReviewData.fileResults;
        crossFileResult = fastReviewData.crossFileResult;
        filesSkipped = fastReviewData.filesSkipped;
        filesAnalyzed = fastReviewData.filesAnalyzed;
        this.phase("file-review", "Reviewing files", "done");
        fileReviewComplete = true;
      } else if (this.reviewProfile.strategy === "multi-agent") {
        this.log("Using multi-agent review mode (specialized subagents + lead synthesizer)...");
        const multiAgentData = await this.performMultiAgentReview(
          prIdentifier,
          prDetails,
          files,
          existingComments,
          cachedState,
          repoPath,
          onTokenUsage
        );
        fileResults = multiAgentData.fileResults;
        crossFileResult = multiAgentData.crossFileResult;
        filesSkipped = multiAgentData.filesSkipped;
        filesAnalyzed = multiAgentData.filesAnalyzed;
        this.phase("file-review", "Reviewing files", "done");
        fileReviewComplete = true;
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
        fileResults = this.lineNumberValidator.validate(fileResults, files);
        this.phase("file-review", "Reviewing files", "done");
        fileReviewComplete = true;

        // Skip cross-file analysis if all files were cached
        if (
          filesSkipped > 0 &&
          filesSkipped === fileResults.length &&
          cachedState?.crossFileResult
        ) {
          this.log("All files unchanged - using cached cross-file analysis");
          this.logger.info({ prIdentifier }, "Reusing cached cross-file analysis");
          crossFileResult = cachedState.crossFileResult;
        } else {
          crossFileResult = await this.runPhase("cross-file", "Cross-file analysis", () =>
            this.performCrossFileAnalysis(
              prDetails,
              files,
              fileResults,
              existingComments,
              repoPath,
              onTokenUsage
            )
          );
        }
      }
    } catch (error) {
      if (!fileReviewComplete) {
        this.phase("file-review", "Reviewing files", "error");
      }
      throw error;
    }

    if (this.options.verifyPbi) {
      crossFileResult = await this.runPhase("verify", "Verifying PR alignment", () =>
        this.pbiVerifier.verifyPRAlignment(prDetails.number, files, crossFileResult, onTokenUsage)
      );
    }

    let commentsCreated = 0;
    let commentErrors: string[] = [];
    let plannedComments: CommentAction[] = [];
    if (postComments) {
      const filePatches = new Map<string, string>(
        files
          .map((f): [string, string] => [f.filename, f.patch ?? ""])
          .filter(([, p]) => p.length > 0)
      );

      const actions = this.commentManager.determineActions(
        existingComments,
        fileResults,
        crossFileResult,
        filePatches
      );

      if (this.options.dryRun) {
        plannedComments = actions;
      }

      const commentStats = await this.runPhase("post", "Posting comments", () =>
        this.executeCommentActions(prDetails.number, actions)
      );
      commentsCreated = commentStats.commentsCreated;
      commentErrors = commentStats.commentErrors;
    }

    // Save state for future re-reviews
    if (saveState) {
      const fileShaMap = this.buildFileShaMap(files);
      await this.stateCache.saveState(prIdentifier, fileResults, fileShaMap, crossFileResult);
    }

    if (commentErrors.length > 0) {
      this.logger.warn(
        {
          errorCount: commentErrors.length,
          errors: commentErrors,
        },
        "Some comments failed to post"
      );
      this.log(`\n⚠️  ${commentErrors.length} comment(s) failed to post`);
    }

    this.logger.info(
      {
        prIdentifier,
        filesReviewed: (filesAnalyzed ?? fileResults.length) - filesSkipped,
        filesSkipped,
        totalFindings: fileResults.reduce((sum, r) => sum + r.findings.length, 0),
        commentsCreated,
        commentErrors: commentErrors.length,
        tokenUsage,
      },
      "PR review completed"
    );

    this.auditLogger.logReviewComplete(
      prDetails.number,
      this.platformName,
      (filesAnalyzed ?? fileResults.length) - filesSkipped,
      filesSkipped,
      commentsCreated,
      commentErrors.length
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
      commentsCreated,
      commentErrors,
      plannedComments,
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
    const allFiles = await this.platform.getPRFiles(prNumber, this.options.ignorePatterns);

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
   * Reviews files with the deep strategy's per-file prompt. Large sets are
   * split into size-capped batches of related files that run concurrently;
   * files the model leaves out of a response are re-reviewed once.
   */
  private async reviewFilesBatched(
    prIdentifier: string,
    files: PRFile[],
    existingComments: readonly ExistingComment[],
    repoPath?: string,
    onTokenUsage?: (usage: TokenUsage | undefined) => void
  ): Promise<FileReviewResult[]> {
    // Filter files with patches
    const filesWithPatches = files.filter((f) => f.patch);
    if (filesWithPatches.length === 0) {
      return files.map((f) => ({ filename: f.filename, findings: [] }));
    }

    const prNumber = parsePRNumberSafe(prIdentifier);
    const auditId = `batched-${filesWithPatches.length}-files`;
    this.auditLogger.logFileReviewStart(auditId, prNumber);

    try {
      const batches = this.planBatches(filesWithPatches);
      if (batches.length > 1) {
        this.log(`Reviewing ${filesWithPatches.length} file(s) in ${batches.length} batches...`);
      }

      // Concurrent batches would interleave in a single streaming display.
      const concurrency = this.streamingEnabled ? 1 : (this.options.batchMaxParallel ?? 3);
      const batchResults = await runWithConcurrency(batches, concurrency, (batch, index) =>
        this.reviewDeepBatchWithCoverage({
          storageId: batches.length === 1 ? prIdentifier : `${prIdentifier}-batch${index + 1}`,
          label:
            batches.length === 1
              ? "Reviewing files..."
              : `Review batch ${index + 1}/${batches.length}...`,
          files: batch,
          existingComments,
          repoPath,
          onTokenUsage,
        })
      );
      const results = this.mergeFileResults(batchResults);

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

      this.auditLogger.logFileReviewComplete(auditId, prNumber, totalFindings);

      // Ensure we have results for all files (fill in missing ones with empty results)
      const resultMap = new Map(results.map((r) => [r.filename, r]));
      return filesWithPatches.map(
        (file) => resultMap.get(file.filename) ?? { filename: file.filename, findings: [] }
      );
    } catch (error) {
      this.auditLogger.logFileReviewComplete(
        auditId,
        prNumber,
        0,
        "failure",
        (error as Error).message
      );
      throw error;
    }
  }

  /** Reviews a deep-strategy batch and re-reviews, once, any file missing from the response. */
  private async reviewDeepBatchWithCoverage(params: {
    storageId: string;
    label: string;
    files: PRFile[];
    existingComments: readonly ExistingComment[];
    repoPath?: string;
    onTokenUsage?: (usage: TokenUsage | undefined) => void;
  }): Promise<FileReviewResult[]> {
    const results = await this.runDeepReviewCall(params);

    // The deep prompt requires an entry for every file, so an absent file was not reviewed.
    const missing = this.findUnreviewedFiles(
      results.map((r) => r.filename),
      params.files,
      true
    );
    if (missing.length === 0) {
      return results;
    }

    this.logger.warn(
      { missingCount: missing.length, missing: missing.map((f) => f.filename) },
      "Batched review did not return results for all files; retrying missing files"
    );

    const retry = await this.runDeepReviewCall({
      ...params,
      storageId: `${params.storageId}-retry`,
      label: `Retrying ${missing.length} unreviewed file(s)...`,
      files: missing,
    });

    const stillMissing = this.findUnreviewedFiles(
      retry.map((r) => r.filename),
      missing,
      true
    );
    if (stillMissing.length > 0) {
      this.logger.warn(
        { missingCount: stillMissing.length, missing: stillMissing.map((f) => f.filename) },
        "Files still unreported after coverage retry"
      );
    }

    return this.mergeFileResults([results, retry]);
  }

  /** Stores the given files' diffs and runs one deep-strategy file-review AI call over them. */
  private async runDeepReviewCall(params: {
    storageId: string;
    label: string;
    files: PRFile[];
    existingComments: readonly ExistingComment[];
    repoPath?: string;
    onTokenUsage?: (usage: TokenUsage | undefined) => void;
  }): Promise<FileReviewResult[]> {
    const { storageId, files, repoPath } = params;
    const tempPath = this.options.tempPath ?? path.join(process.cwd(), ".mergementor");
    const diffStorage = new DiffStorage(tempPath, this.fileSystem);

    try {
      // Store diffs to disk
      const { diffDir, manifest } = await diffStorage.storeDiffs(storageId, files);
      this.logger.info(
        {
          storageId,
          fileCount: manifest.files.length,
          diffDir,
          reviewPasses: this.reviewProfile.passes,
        },
        "Stored diffs for batched review"
      );

      // Copy diff files to repo's .mergementor directory so AI can access them
      this.logger.debug("Copying diffs to repo's .mergementor directory for AI access");
      const { paths: diffFiles, totalSize } = await this.workspaceManager.copyDiffsToRepoDir(
        diffDir,
        manifest,
        repoPath
      );

      // Build prompt from the resolved baseline profile
      const commentsContext = formatExistingCommentsContext(params.existingComments);
      const prompt = buildGeneralFileReviewPrompt(manifest, commentsContext || undefined, repoPath);
      const shouldAttach = totalSize <= ATTACHMENT_SIZE_THRESHOLD_BYTES;
      this.logger.debug(
        {
          promptLength: prompt.length,
          promptPreview: prompt.substring(0, 2000),
          promptSuffix: prompt.substring(Math.max(0, prompt.length - 500)),
          hasRepoPath: !!repoPath,
          reviewPasses: this.reviewProfile.passes,
          totalSize,
          shouldAttach,
        },
        "Batched prompt being sent"
      );

      const streaming = this.createStreamingCallback(params.label, "file-review");
      let response: AIResponse;
      try {
        response = await this.provider.executePrompt(prompt, {
          promptType: "batched-file-review",
          workingDirectory: repoPath,
          onStreamData: streaming.callback,
          ...(shouldAttach ? { diffFiles } : {}),
        });
      } finally {
        streaming.finish();
      }
      params.onTokenUsage?.(response.tokenUsage);
      return this.provider.parseBatchedFileReview(response);
    } finally {
      // Clean up diffs
      await diffStorage.cleanup(storageId);
    }
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

      const prompt = buildGeneralCrossFilePrompt(prDetails, context, repoPath);
      this.logger.info(
        {
          reviewPasses: this.reviewProfile.passes,
        },
        "Built resolved cross-file prompt"
      );

      const streaming = this.createStreamingCallback("Cross-file analysis...", "cross-file");
      let response: AIResponse;
      try {
        response = await this.provider.executePrompt(prompt, {
          promptType: "cross-file-review",
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

  private combineCrossFileResults(
    cached?: CrossFileReviewResult,
    current?: CrossFileReviewResult
  ): CrossFileReviewResult {
    if (!cached) {
      return (
        current ?? {
          overallAssessment: "No files to review",
          findings: [],
          recommendations: [],
        }
      );
    }
    if (!current) return cached;

    const existingKeys = new Set(
      cached.findings.map((f) => `${f.message}:${(f.affectedFiles ?? []).join(",")}`)
    );
    const uniqueNewFindings = current.findings.filter(
      (f) => !existingKeys.has(`${f.message}:${(f.affectedFiles ?? []).join(",")}`)
    );

    return {
      overallAssessment: current.overallAssessment,
      findings: [...cached.findings, ...uniqueNewFindings],
      recommendations: Array.from(new Set([...current.recommendations, ...cached.recommendations])),
    };
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
    cachedState?: Awaited<ReturnType<ReviewStateCache["getState"]>>,
    repoPath?: string,
    onTokenUsage?: (usage: TokenUsage | undefined) => void
  ): Promise<{
    fileResults: FileReviewResult[];
    crossFileResult: CrossFileReviewResult;
    filesSkipped: number;
    filesAnalyzed: number;
  }> {
    this.log("Performing fast review (combined file + architectural analysis)...");

    const prNumber = parsePRNumberSafe(prIdentifier);
    this.auditLogger.logFileReviewStart("fast-review", prNumber);

    // Filter unchanged files vs files requiring review
    const filesToReview: PRFile[] = [];
    const cachedResults: FileReviewResult[] = [];
    let filesSkipped = 0;

    for (const file of files) {
      if (this.shouldSkipFile(file) || !file.patch) continue;

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

    // Full cache hit check
    if (filesToReview.length === 0) {
      if (cachedState?.crossFileResult) {
        this.log(`Skipped ${filesSkipped} unchanged file(s) from previous review in fast mode`);
        return {
          fileResults: cachedResults,
          crossFileResult: cachedState.crossFileResult,
          filesSkipped,
          filesAnalyzed: cachedResults.length,
        };
      }
      // Fallback: If cached crossFileResult is missing, process all files with patches to regenerate it
      filesToReview.push(...files.filter((f) => !this.shouldSkipFile(f) && f.patch));
    }

    if (filesToReview.length === 0) {
      return {
        fileResults: cachedResults,
        crossFileResult: cachedState?.crossFileResult ?? {
          overallAssessment: "No files to review",
          findings: [],
          recommendations: [],
        },
        filesSkipped,
        filesAnalyzed: cachedResults.length,
      };
    }

    try {
      const batches = this.planBatches(filesToReview);

      let result: FastReviewResult;
      if (batches.length <= 1) {
        result = await this.reviewBatchWithCoverage({
          storageId: prIdentifier,
          label: "Fast review (file + architecture)...",
          prIdentifier,
          prDetails,
          files: filesToReview,
          existingComments,
          repoPath,
          onTokenUsage,
        });
      } else {
        result = await this.reviewInBatches({
          batches,
          prIdentifier,
          prDetails,
          filesToReview,
          cachedResults,
          existingComments,
          repoPath,
          onTokenUsage,
        });
      }

      // Validate line numbers specifically on filesToReview
      const validatedNewResults = this.lineNumberValidator.validate(
        result.fileResults,
        filesToReview
      );
      const resultMap = new Map(validatedNewResults.map((r) => [r.filename, r]));
      const completeNewResults: FileReviewResult[] = filesToReview.map((file) => {
        return (
          resultMap.get(file.filename) ?? {
            filename: file.filename,
            findings: [],
          }
        );
      });
      const mergedFileResults = [...cachedResults, ...completeNewResults];
      const combinedCrossFile = this.combineCrossFileResults(
        cachedState?.crossFileResult,
        result.crossFileResult
      );

      // Log results
      const totalFileFindings = mergedFileResults.reduce((sum, r) => sum + r.findings.length, 0);
      const crossFileFindings = combinedCrossFile.findings.length;
      this.log(
        `  Fast review found ${totalFileFindings} file-level issues and ${crossFileFindings} architectural issues`
      );

      for (const fileResult of mergedFileResults) {
        if (fileResult.findings.length > 0) {
          this.log(`    ${fileResult.filename}: ${fileResult.findings.length} issues`);
        }
      }

      if (filesSkipped > 0) {
        this.log(`Skipped ${filesSkipped} unchanged file(s) from previous review in fast mode`);
      }

      this.auditLogger.logFileReviewComplete("fast-review", prNumber, totalFileFindings);
      this.auditLogger.logCrossFileReviewComplete(prNumber, crossFileFindings);

      return {
        fileResults: mergedFileResults,
        crossFileResult: combinedCrossFile,
        filesSkipped,
        filesAnalyzed: mergedFileResults.length,
      };
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

  /**
   * Reviews a large set of files as several size-capped batches of related
   * files, then merges the per-batch results in code and runs one cross-file
   * pass over the findings (not the raw diffs) to catch issues that span batches.
   */
  private async reviewInBatches(params: {
    batches: readonly PRFile[][];
    prIdentifier: string;
    prDetails: PRDetails;
    filesToReview: PRFile[];
    cachedResults: readonly FileReviewResult[];
    existingComments: readonly ExistingComment[];
    repoPath?: string;
    onTokenUsage?: (usage: TokenUsage | undefined) => void;
  }): Promise<FastReviewResult> {
    const { batches, prIdentifier, prDetails, filesToReview, existingComments, repoPath } = params;

    this.log(`Reviewing ${filesToReview.length} file(s) in ${batches.length} batches...`);
    this.logger.info(
      { batchCount: batches.length, batchSizes: batches.map((batch) => batch.length) },
      "Planned fast review batches"
    );

    // Concurrent batches would interleave in a single streaming display.
    const concurrency = this.streamingEnabled ? 1 : (this.options.batchMaxParallel ?? 3);
    const batchResults = await runWithConcurrency(batches, concurrency, (batch, index) =>
      this.reviewBatchWithCoverage({
        storageId: `${prIdentifier}-batch${index + 1}`,
        label: `Review batch ${index + 1}/${batches.length}...`,
        prIdentifier,
        prDetails,
        files: batch,
        existingComments,
        repoPath,
        onTokenUsage: params.onTokenUsage,
      })
    );

    return this.addCrossBatchAnalysis(this.mergeFastReviewResults(batchResults), {
      prDetails,
      filesToReview,
      cachedResults: params.cachedResults,
      existingComments,
      repoPath,
      onTokenUsage: params.onTokenUsage,
    });
  }

  /**
   * Runs one cross-file pass over the merged per-batch findings (not the raw
   * diffs) to catch issues that span batches. A failure keeps the batch-level
   * cross-file results.
   */
  private async addCrossBatchAnalysis(
    merged: FastReviewResult,
    params: {
      prDetails: PRDetails;
      filesToReview: PRFile[];
      cachedResults: readonly FileReviewResult[];
      existingComments: readonly ExistingComment[];
      repoPath?: string;
      onTokenUsage?: (usage: TokenUsage | undefined) => void;
    }
  ): Promise<FastReviewResult> {
    try {
      const crossPass = await this.runPhase("cross-file", "Cross-file analysis", () =>
        this.performCrossFileAnalysis(
          params.prDetails,
          params.filesToReview,
          [...params.cachedResults, ...merged.fileResults],
          params.existingComments,
          params.repoPath,
          params.onTokenUsage
        )
      );
      return {
        ...merged,
        crossFileResult: this.combineCrossFileResults(merged.crossFileResult, crossPass),
      };
    } catch (error) {
      this.logger.warn(
        { error: (error as Error).message },
        "Cross-batch analysis failed; using batch-level cross-file results"
      );
      return merged;
    }
  }

  /** Splits files into size-capped batches of related files using the configured limits. */
  private planBatches(files: PRFile[]): PRFile[][] {
    return planReviewBatches(files, {
      maxBytes: this.options.batchMaxBytes ?? DEFAULT_BATCH_MAX_BYTES,
      maxFiles: this.options.batchMaxFiles ?? DEFAULT_BATCH_MAX_FILES,
    });
  }

  /** Merges per-file results from several batches, concatenating findings for repeated files. */
  private mergeFileResults(lists: readonly (readonly FileReviewResult[])[]): FileReviewResult[] {
    const fileMap = new Map<string, FileReviewResult>();
    for (const list of lists) {
      for (const fileResult of list) {
        const existing = fileMap.get(fileResult.filename);
        fileMap.set(
          fileResult.filename,
          existing
            ? { ...existing, findings: [...existing.findings, ...fileResult.findings] }
            : fileResult
        );
      }
    }
    return [...fileMap.values()];
  }

  /**
   * Reviews `files` in one AI call and, if the model did not report some of
   * them, re-reviews just the missing files once in a small follow-up call.
   */
  private async reviewBatchWithCoverage(params: {
    storageId: string;
    label: string;
    prIdentifier: string;
    prDetails: PRDetails;
    files: PRFile[];
    existingComments: readonly ExistingComment[];
    repoPath?: string;
    onTokenUsage?: (usage: TokenUsage | undefined) => void;
  }): Promise<FastReviewResult> {
    const result = await this.runFastReviewCall(params);
    const missing = this.findUnreviewedFiles(result.reviewedFiles, params.files);
    if (missing.length === 0) {
      return result;
    }

    this.logger.warn(
      { missingCount: missing.length, missing: missing.map((f) => f.filename) },
      "Fast review did not report coverage for all files; retrying missing files"
    );

    const retry = await this.runFastReviewCall({
      ...params,
      storageId: `${params.storageId}-retry`,
      label: `Retrying ${missing.length} unreviewed file(s)...`,
      files: missing,
    });

    const stillMissing = this.findUnreviewedFiles(retry.reviewedFiles, missing);
    if (stillMissing.length > 0) {
      this.logger.warn(
        { missingCount: stillMissing.length, missing: stillMissing.map((f) => f.filename) },
        "Files still unreported after coverage retry"
      );
    }

    return this.mergeFastReviewResults([result, retry]);
  }

  /** Stores the given files' diffs, runs one fast-review AI call over them, and parses it. */
  private async runFastReviewCall(params: {
    storageId: string;
    label: string;
    prIdentifier: string;
    prDetails: PRDetails;
    files: PRFile[];
    existingComments: readonly ExistingComment[];
    repoPath?: string;
    onTokenUsage?: (usage: TokenUsage | undefined) => void;
  }): Promise<FastReviewResult> {
    const { storageId, files, repoPath } = params;
    const tempPath = this.options.tempPath ?? path.join(process.cwd(), ".mergementor");
    const diffStorage = new DiffStorage(tempPath, this.fileSystem);

    try {
      // Store diffs to disk
      const { diffDir, manifest } = await diffStorage.storeDiffs(storageId, files);
      this.logger.info(
        { storageId, fileCount: manifest.files.length, diffDir },
        "Stored diffs for fast review"
      );

      // Copy diff files to repo's .mergementor directory for AI access
      const { paths: diffFiles, totalSize } = await this.workspaceManager.copyDiffsToRepoDir(
        diffDir,
        manifest,
        repoPath
      );

      // Build combined prompt for fast review
      const commentsContext = formatExistingCommentsContext(params.existingComments);
      const prompt = buildFastReviewPrompt(
        params.prDetails,
        manifest,
        commentsContext || undefined,
        repoPath
      );

      this.logger.info({ promptLength: prompt.length }, "Built fast review prompt");

      const shouldAttach = totalSize <= ATTACHMENT_SIZE_THRESHOLD_BYTES;
      this.logger.info(
        { totalSize, shouldAttach, threshold: ATTACHMENT_SIZE_THRESHOLD_BYTES },
        "Evaluated diff size for fast review attachments"
      );

      const streaming = this.createStreamingCallback(params.label, "file-review");
      let response: AIResponse;
      try {
        response = await this.provider.executePrompt(prompt, {
          promptType: "fast-review",
          workingDirectory: repoPath,
          onStreamData: streaming.callback,
          ...(shouldAttach ? { diffFiles } : {}),
        });
      } finally {
        streaming.finish();
      }
      params.onTokenUsage?.(response.tokenUsage);

      return this.provider.parseFastReview(response);
    } finally {
      await diffStorage.cleanup(storageId);
    }
  }

  /** Merges fast-review results in code: per-file findings are concatenated and cross-file findings de-duplicated. */
  private mergeFastReviewResults(results: readonly FastReviewResult[]): FastReviewResult {
    const crossFindings = new Map<string, CrossFileReviewResult["findings"][number]>();
    for (const { crossFileResult } of results) {
      for (const finding of crossFileResult.findings) {
        const key = `${finding.message}:${(finding.affectedFiles ?? []).join(",")}`;
        if (!crossFindings.has(key)) {
          crossFindings.set(key, finding);
        }
      }
    }

    const assessments = Array.from(
      new Set(results.map((r) => r.crossFileResult.overallAssessment).filter(Boolean))
    );

    return {
      fileResults: this.mergeFileResults(results.map((r) => r.fileResults)),
      crossFileResult: {
        overallAssessment: assessments.join(" "),
        findings: [...crossFindings.values()],
        recommendations: Array.from(
          new Set(results.flatMap((r) => r.crossFileResult.recommendations))
        ),
      },
      reviewedFiles: results.flatMap((r) => r.reviewedFiles),
    };
  }

  /**
   * Returns the subset of `filesToReview` that the model did not report in
   * `reviewedFiles`. Returns an empty array when the provider reported no
   * coverage (e.g. the multi-agent synthesizer or legacy callers) so that
   * coverage is only checked when it can actually be verified. When
   * `requireReport` is set, an empty report means nothing was reviewed.
   */
  private findUnreviewedFiles(
    reviewedFiles: readonly string[],
    filesToReview: readonly PRFile[],
    requireReport = false
  ): PRFile[] {
    if (!reviewedFiles || reviewedFiles.length === 0) {
      return requireReport ? [...filesToReview] : [];
    }

    const normalized = reviewedFiles.map((file) => normalizeRepoPath(file));

    // A bare basename ("index.ts") only counts when it identifies exactly one
    // file in this batch; otherwise one reported file would mask all its namesakes.
    const basenameCounts = new Map<string, number>();
    for (const file of filesToReview) {
      const base = path.posix.basename(normalizeRepoPath(file.filename));
      basenameCounts.set(base, (basenameCounts.get(base) ?? 0) + 1);
    }

    return filesToReview.filter((file) => {
      const target = normalizeRepoPath(file.filename);
      const base = path.posix.basename(target);
      return !normalized.some(
        (reviewed) =>
          reviewed === target ||
          reviewed.endsWith(`/${target}`) ||
          (reviewed === base && basenameCounts.get(base) === 1)
      );
    });
  }

  /**
   * Performs a multi-agent review: specialized subagents (Security, Performance,
   * Test Coverage, Architecture) run concurrently over the diff, then a Lead
   * Synthesizer deduplicates, filters, and compiles the unified report.
   *
   * Uses the same cache/diff storage plumbing as fast review so unchanged files
   * are skipped and diffs are available to the AI workspace.
   */
  private async performMultiAgentReview(
    prIdentifier: string,
    prDetails: PRDetails,
    files: PRFile[],
    existingComments: readonly ExistingComment[],
    cachedState?: Awaited<ReturnType<ReviewStateCache["getState"]>>,
    repoPath?: string,
    onTokenUsage?: (usage: TokenUsage | undefined) => void
  ): Promise<{
    fileResults: FileReviewResult[];
    crossFileResult: CrossFileReviewResult;
    filesSkipped: number;
    filesAnalyzed: number;
  }> {
    this.log("Performing multi-agent review (specialized subagents + lead synthesizer)...");

    const prNumber = parsePRNumberSafe(prIdentifier);
    this.auditLogger.logFileReviewStart("multi-agent", prNumber);

    // Filter unchanged files vs files requiring review
    const filesToReview: PRFile[] = [];
    const cachedResults: FileReviewResult[] = [];
    let filesSkipped = 0;

    for (const file of files) {
      if (this.shouldSkipFile(file) || !file.patch) continue;

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

    // Full cache hit check
    if (filesToReview.length === 0) {
      if (cachedState?.crossFileResult) {
        this.log(
          `Skipped ${filesSkipped} unchanged file(s) from previous review in multi-agent mode`
        );
        return {
          fileResults: cachedResults,
          crossFileResult: cachedState.crossFileResult,
          filesSkipped,
          filesAnalyzed: cachedResults.length,
        };
      }
      // Fallback: If cached crossFileResult is missing, process all files with patches to regenerate it
      filesToReview.push(...files.filter((f) => !this.shouldSkipFile(f) && f.patch));
    }

    if (filesToReview.length === 0) {
      return {
        fileResults: cachedResults,
        crossFileResult: cachedState?.crossFileResult ?? {
          overallAssessment: "No files to review",
          findings: [],
          recommendations: [],
        },
        filesSkipped,
        filesAnalyzed: cachedResults.length,
      };
    }

    try {
      const batches = this.planBatches(filesToReview);
      if (batches.length > 1) {
        this.log(`Reviewing ${filesToReview.length} file(s) in ${batches.length} batches...`);
      }

      // Each batch runs the full subagent set (which is already parallel) plus the
      // synthesizer, so batches run one after another.
      const batchOutputs: FastReviewResult[] = [];
      for (const [index, batch] of batches.entries()) {
        batchOutputs.push(
          await this.runMultiAgentBatch({
            storageId: batches.length === 1 ? prIdentifier : `${prIdentifier}-batch${index + 1}`,
            prDetails,
            files: batch,
            existingComments,
            repoPath,
            onTokenUsage,
          })
        );
      }

      let multiAgentOutput = this.mergeFastReviewResults(batchOutputs);
      if (batches.length > 1) {
        multiAgentOutput = await this.addCrossBatchAnalysis(multiAgentOutput, {
          prDetails,
          filesToReview,
          cachedResults,
          existingComments,
          repoPath,
          onTokenUsage,
        });
      }

      // Validate line numbers specifically on filesToReview
      const validatedNewResults = this.lineNumberValidator.validate(
        [...multiAgentOutput.fileResults],
        filesToReview
      );
      const resultMap = new Map(validatedNewResults.map((r) => [r.filename, r]));
      const completeNewResults: FileReviewResult[] = filesToReview.map((file) => {
        return (
          resultMap.get(file.filename) ?? {
            filename: file.filename,
            findings: [],
          }
        );
      });
      const mergedFileResults = [...cachedResults, ...completeNewResults];
      const combinedCrossFile = this.combineCrossFileResults(
        cachedState?.crossFileResult,
        multiAgentOutput.crossFileResult
      );

      // Log results
      const totalFileFindings = mergedFileResults.reduce((sum, r) => sum + r.findings.length, 0);
      const crossFileFindings = combinedCrossFile.findings.length;
      this.log(
        `  Multi-agent review found ${totalFileFindings} file-level issues and ${crossFileFindings} architectural issues`
      );

      for (const fileResult of mergedFileResults) {
        if (fileResult.findings.length > 0) {
          this.log(`    ${fileResult.filename}: ${fileResult.findings.length} issues`);
        }
      }

      if (filesSkipped > 0) {
        this.log(
          `Skipped ${filesSkipped} unchanged file(s) from previous review in multi-agent mode`
        );
      }

      this.auditLogger.logFileReviewComplete("multi-agent", prNumber, totalFileFindings);
      this.auditLogger.logCrossFileReviewComplete(prNumber, crossFileFindings);

      return {
        fileResults: mergedFileResults,
        crossFileResult: combinedCrossFile,
        filesSkipped,
        filesAnalyzed: mergedFileResults.length,
      };
    } catch (error) {
      this.auditLogger.logFileReviewComplete(
        "multi-agent",
        prNumber,
        0,
        "failure",
        (error as Error).message
      );
      throw error;
    }
  }

  /** Stores the given files' diffs and runs the full multi-agent pipeline (subagents + synthesizer) over them. */
  private async runMultiAgentBatch(params: {
    storageId: string;
    prDetails: PRDetails;
    files: PRFile[];
    existingComments: readonly ExistingComment[];
    repoPath?: string;
    onTokenUsage?: (usage: TokenUsage | undefined) => void;
  }): Promise<FastReviewResult> {
    const { storageId, repoPath } = params;
    const tempPath = this.options.tempPath ?? path.join(process.cwd(), ".mergementor");
    const diffStorage = new DiffStorage(tempPath, this.fileSystem);

    try {
      // Store diffs to disk
      const { diffDir, manifest } = await diffStorage.storeDiffs(storageId, params.files);
      this.logger.info(
        { storageId, fileCount: manifest.files.length, diffDir },
        "Stored diffs for multi-agent review"
      );

      // Copy diff files to repo's .mergementor directory for AI access
      const { paths: diffFiles } = await this.workspaceManager.copyDiffsToRepoDir(
        diffDir,
        manifest,
        repoPath
      );

      const orchestrator = new MultiAgentOrchestrator(this.provider, {
        passes: this.reviewProfile.passes,
        maxParallel: this.options.multiAgentMaxParallel ?? 2,
        output: this.output,
        onProgress: this.options.onProgress,
        streamPhase: "file-review",
        streaming: {
          enabled: this.streamingEnabled,
          lines: this.streamingLines,
          ciMode: this.options.ciMode ?? false,
        },
      });

      const output = await orchestrator.review({
        prDetails: params.prDetails,
        manifest,
        diffFiles,
        existingComments: params.existingComments,
        repoPath,
      });
      params.onTokenUsage?.(output.tokenUsage);

      return {
        fileResults: [...output.fileResults],
        crossFileResult: output.crossFileResult,
        reviewedFiles: [],
      };
    } finally {
      await diffStorage.cleanup(storageId);
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
          if (action.startLine !== undefined) {
            await this.platform.postInlineComment(
              prNumber,
              action.path,
              action.line,
              action.body,
              action.startLine
            );
          } else {
            await this.platform.postInlineComment(prNumber, action.path, action.line, action.body);
          }
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
        const exhaustive: never = action.type;
        throw new Error(`Unknown comment action type: ${exhaustive}`);
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
