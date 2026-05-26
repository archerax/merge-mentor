import { createChildLogger } from "../logger.js";
import { type Clock, systemClock } from "../ports/index.js";

/**
 * Audit logging module for security and compliance tracking.
 *
 * Records all critical operations performed by the review engine including:
 * - PR data access (details, files, comments)
 * - Comment operations (creation, posting)
 * - AI provider executions (requests, completions)
 * - Review lifecycle (start, file analysis, cross-file analysis, completion)
 *
 * Each audit entry includes:
 * - Event type and timestamp
 * - Actor (who performed the action)
 * - Resource (what was affected)
 * - Result status (success, failure, partial)
 * - Optional metadata and error details
 *
 * Audit logging can be disabled via AuditLoggerOptions.enabled = false.
 *
 * @example
 * ```typescript
 * import { getAuditLogger } from "../audit/index.js";
 *
 * const auditLogger = getAuditLogger();
 *
 * // Log PR review start
 * auditLogger.logReviewStart(123, "github", 2, "security");
 *
 * // Log file analysis
 * auditLogger.logFileReviewStart("src/auth.ts", 123);
 * auditLogger.logFileReviewComplete("src/auth.ts", 123, 3);
 *
 * // Log AI execution
 * auditLogger.logAIProviderExecution(
 *   "copilot-sdk",
 *   "file-review",
 *   "gpt-4",
 *   "success",
 *   undefined,
 *   { inputTokens: 1024, outputTokens: 512 }
 * );
 * ```
 */

/**
 * Audit event types for security and compliance tracking.
 *
 * Represents all significant operations that should be logged for compliance
 * and security audit trails.
 */
type AuditEventType =
  | "pr.details.fetch"
  | "pr.files.fetch"
  | "pr.comments.fetch"
  | "comment.post.inline"
  | "comment.post.general"
  | "copilot.execute"
  | "ai.provider.execute"
  | "review.start"
  | "review.complete"
  | "file.review.start"
  | "file.review.complete"
  | "crossfile.review.start"
  | "crossfile.review.complete";

/**
 * Audit event severity levels.
 *
 * - info: Operation completed successfully
 * - warn: Operation partially completed or had non-critical issues
 * - error: Operation failed
 */
type AuditSeverity = "info" | "warn" | "error";

/**
 * Base audit event structure.
 *
 * Represents a single auditable action with its context, result, and any errors.
 */
interface AuditEvent {
  readonly eventType: AuditEventType;
  readonly timestamp: string;
  readonly severity: AuditSeverity;
  readonly actor: string;
  readonly resource: AuditResource;
  readonly action: string;
  readonly result: "success" | "failure" | "partial";
  readonly metadata?: Record<string, unknown>;
  readonly error?: string;
}

/**
 * Resource being acted upon.
 *
 * Identifies what was affected by the operation (PR, file, comment, etc.)
 * with optional details about the resource.
 */
interface AuditResource {
  readonly type: "pr" | "file" | "comment" | "ai" | "review";
  readonly id: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Options for audit logger configuration.
 *
 * @example
 * ```typescript
 * const logger = new AuditLogger({
 *   enabled: true,
 *   actor: "github-actions-bot",
 *   clock: systemClock
 * });
 * ```
 */
interface AuditLoggerOptions {
  /**
   * Enable or disable audit logging.
   * When disabled, logEvent and helper methods become no-ops.
   * Default: true
   */
  readonly enabled?: boolean;
  /**
   * Actor identifier (user or service performing the action).
   * Default: "merge-mentor-bot"
   */
  readonly actor?: string;
  /**
   * Clock implementation for timestamps.
   * Default: systemClock (enables time mocking in tests)
   */
  readonly clock?: Clock;
}

/**
 * Audit logger for security and compliance tracking.
 *
 * Logs all critical actions taken by the application for compliance audits,
 * security investigation, and operational monitoring. Each logged event includes
 * context, result status, and metadata for actionable investigation.
 *
 * @example
 * ```typescript
 * const auditLogger = new AuditLogger({ actor: "review-engine" });
 * auditLogger.logReviewComplete(456, "github", 5, 2, 3, 0);
 * // Logs: { eventType: "review.complete", result: "success", filesReviewed: 5, ... }
 * ```
 */
export class AuditLogger {
  private readonly logger = createChildLogger({ component: "AuditLogger" });
  private readonly enabled: boolean;
  private readonly actor: string;
  private readonly clock: Clock;

  constructor(options?: AuditLoggerOptions) {
    this.enabled = options?.enabled ?? true;
    this.actor = options?.actor ?? "merge-mentor-bot";
    this.clock = options?.clock ?? systemClock;
  }

  /**
   * Logs a generic audit event.
   *
   * This is the base method used by all helper methods. Logs to the child logger
   * with audit context in a structured format.
   *
   * @param eventType - Type of event being logged
   * @param resource - Resource being acted upon
   * @param action - Human-readable description of the action
   * @param result - Outcome of the action (success, failure, partial)
   * @param metadata - Additional context as key-value pairs
   * @param error - Error message if action failed
   */
  logEvent(
    eventType: AuditEventType,
    resource: AuditResource,
    action: string,
    result: "success" | "failure" | "partial",
    metadata?: Record<string, unknown>,
    error?: string
  ): void {
    if (!this.enabled) return;

    const severity: AuditSeverity =
      result === "failure" ? "error" : result === "partial" ? "warn" : "info";

    const event: AuditEvent = {
      eventType,
      timestamp: this.clock.timestamp(),
      severity,
      actor: this.actor,
      resource,
      action,
      result,
      metadata,
      error,
    };

    this.logger.info({ audit: event }, `AUDIT: ${eventType} - ${action}`);
  }

  /**
   * Logs PR details fetch operation.
   *
   * Called when retrieving PR metadata (title, description, author, branches, etc.)
   * from the platform API.
   *
   * @param prNumber - PR number/ID
   * @param platform - Platform name (github, azure)
   * @param result - Operation result (success or failure)
   * @param error - Error message if operation failed
   */
  logPRDetailsFetch(
    prNumber: number,
    platform: string,
    result: "success" | "failure",
    error?: string
  ): void {
    this.logEvent(
      "pr.details.fetch",
      { type: "pr", id: prNumber.toString(), details: { platform } },
      `Fetch PR #${prNumber} details`,
      result,
      { platform },
      error
    );
  }

  /**
   * Logs PR files fetch operation.
   *
   * Called when retrieving the list of files changed in a PR from the platform API.
   *
   * @param prNumber - PR number/ID
   * @param platform - Platform name (github, azure)
   * @param filesCount - Number of files fetched (optional)
   * @param result - Operation result (success or failure, default: success)
   * @param error - Error message if operation failed
   */
  logPRFilesFetch(
    prNumber: number,
    platform: string,
    filesCount?: number,
    result: "success" | "failure" = "success",
    error?: string
  ): void {
    this.logEvent(
      "pr.files.fetch",
      { type: "pr", id: prNumber.toString(), details: { platform } },
      `Fetch files for PR #${prNumber}`,
      result,
      { platform, filesCount },
      error
    );
  }

  /**
   * Logs existing comments fetch operation.
   *
   * Called when retrieving bot comments already posted on a PR to avoid duplicates.
   *
   * @param prNumber - PR number/ID
   * @param platform - Platform name (github, azure)
   * @param commentsCount - Number of existing comments found (optional)
   * @param result - Operation result (success or failure, default: success)
   * @param error - Error message if operation failed
   */
  logCommentsFetch(
    prNumber: number,
    platform: string,
    commentsCount?: number,
    result: "success" | "failure" = "success",
    error?: string
  ): void {
    this.logEvent(
      "pr.comments.fetch",
      { type: "pr", id: prNumber.toString(), details: { platform } },
      `Fetch existing comments for PR #${prNumber}`,
      result,
      { platform, commentsCount },
      error
    );
  }

  /**
   * Logs inline comment post operation.
   *
   * Called when posting a comment on a specific file and line number within a PR.
   *
   * @param prNumber - PR number/ID
   * @param path - File path being commented on
   * @param line - Line number being commented on
   * @param platform - Platform name (github, azure)
   * @param result - Operation result (success or failure)
   * @param error - Error message if operation failed
   */
  logInlineCommentPost(
    prNumber: number,
    path: string,
    line: number,
    platform: string,
    result: "success" | "failure",
    error?: string
  ): void {
    this.logEvent(
      "comment.post.inline",
      {
        type: "comment",
        id: `pr-${prNumber}-${path}-${line}`,
        details: { prNumber, path, line, platform },
      },
      `Post inline comment on PR #${prNumber} at ${path}:${line}`,
      result,
      { prNumber, path, line, platform },
      error
    );
  }

  /**
   * Logs general comment post operation.
   *
   * Called when posting a general comment at the PR level (not tied to a specific file/line).
   *
   * @param prNumber - PR number/ID
   * @param platform - Platform name (github, azure)
   * @param result - Operation result (success or failure)
   * @param error - Error message if operation failed
   */
  logGeneralCommentPost(
    prNumber: number,
    platform: string,
    result: "success" | "failure",
    error?: string
  ): void {
    this.logEvent(
      "comment.post.general",
      {
        type: "comment",
        id: `pr-${prNumber}-general`,
        details: { prNumber, platform },
      },
      `Post general comment on PR #${prNumber}`,
      result,
      { prNumber, platform },
      error
    );
  }

  /**
   * Logs AI provider execution.
   *
   * Called when executing a prompt with the configured AI provider (Copilot SDK, OpenCode, etc.).
   * Includes token usage information for cost tracking and provider billing.
   *
   * @param provider - Provider name (copilot-sdk, opencode-sdk, etc.)
   * @param promptType - Type of prompt (file-review, cross-file-review, batched-file-review, fast-review)
   * @param model - Model name if specified (e.g., gpt-4, claude-3)
   * @param result - Operation result (success or failure)
   * @param error - Error message if operation failed
   * @param tokenUsage - Token usage statistics from the AI provider (optional)
   */
  logAIProviderExecution(
    provider: string,
    promptType: string,
    model?: string,
    result: "success" | "failure" = "success",
    error?: string,
    tokenUsage?: {
      inputTokens: number;
      outputTokens: number;
      cachedTokens?: number;
      premiumRequests?: number;
      model?: string;
      durationApiSeconds?: number;
      durationWallSeconds?: number;
    }
  ): void {
    const metadata: Record<string, unknown> = { provider, promptType, model };

    if (tokenUsage) {
      metadata.tokenUsage = tokenUsage;
    }

    this.logEvent(
      "ai.provider.execute",
      {
        type: "ai",
        id: `${provider}:${promptType}`,
        details: { provider, model },
      },
      `Execute ${provider} prompt: ${promptType}`,
      result,
      metadata,
      error
    );
  }

  /**
   * Logs review start.
   */
  logReviewStart(
    prNumber: number,
    platform: string,
    reviewType?: string,
    reviewPasses?: readonly string[],
    reviewStrategy?: string
  ): void {
    this.logEvent(
      "review.start",
      { type: "review", id: `pr-${prNumber}`, details: { platform } },
      `Start review of PR #${prNumber}`,
      "success",
      {
        prNumber,
        platform,
        reviewType: reviewType ?? "general",
        ...(reviewPasses && reviewPasses.length > 0 ? { reviewPasses } : {}),
        ...(reviewStrategy ? { reviewStrategy } : {}),
      }
    );
  }

  /**
   * Logs review completion.
   */
  logReviewComplete(
    prNumber: number,
    platform: string,
    filesReviewed: number,
    filesSkipped: number,
    commentsCreated: number,
    commentErrors: number,
    result: "success" | "partial" = "success"
  ): void {
    const resultStatus = commentErrors > 0 ? "partial" : result;
    this.logEvent(
      "review.complete",
      { type: "review", id: `pr-${prNumber}`, details: { platform } },
      `Complete review of PR #${prNumber}`,
      resultStatus,
      {
        prNumber,
        platform,
        filesReviewed,
        filesSkipped,
        commentsCreated,
        commentErrors,
      }
    );
  }

  /**
   * Logs file review start.
   */
  logFileReviewStart(filename: string, prNumber: number): void {
    this.logEvent(
      "file.review.start",
      { type: "file", id: filename, details: { prNumber } },
      `Start reviewing file: ${filename}`,
      "success",
      { filename, prNumber }
    );
  }

  /**
   * Logs file review completion.
   */
  logFileReviewComplete(
    filename: string,
    prNumber: number,
    findingsCount: number,
    result: "success" | "failure" = "success",
    error?: string
  ): void {
    this.logEvent(
      "file.review.complete",
      { type: "file", id: filename, details: { prNumber } },
      `Complete reviewing file: ${filename}`,
      result,
      { filename, prNumber, findingsCount },
      error
    );
  }

  /**
   * Logs cross-file review start.
   */
  logCrossFileReviewStart(prNumber: number, filesCount: number): void {
    this.logEvent(
      "crossfile.review.start",
      { type: "review", id: `pr-${prNumber}-crossfile`, details: { prNumber } },
      `Start cross-file analysis for PR #${prNumber}`,
      "success",
      { prNumber, filesCount }
    );
  }

  /**
   * Logs cross-file review completion.
   */
  logCrossFileReviewComplete(
    prNumber: number,
    findingsCount: number,
    result: "success" | "failure" = "success",
    error?: string
  ): void {
    this.logEvent(
      "crossfile.review.complete",
      { type: "review", id: `pr-${prNumber}-crossfile`, details: { prNumber } },
      `Complete cross-file analysis for PR #${prNumber}`,
      result,
      { prNumber, findingsCount },
      error
    );
  }
}

/** Singleton audit logger instance. */
let _auditLogger: AuditLogger | undefined;

/**
 * Gets or creates the singleton audit logger instance.
 *
 * On first call, creates an AuditLogger with provided options.
 * Subsequent calls return the same instance (singleton pattern).
 *
 * @param options - Configuration for the audit logger (only used on first call)
 * @returns The singleton AuditLogger instance
 *
 * @example
 * ```typescript
 * // First call creates the instance
 * const logger1 = getAuditLogger({ enabled: true, actor: "review-engine" });
 *
 * // Subsequent calls return the same instance
 * const logger2 = getAuditLogger();  // Returns logger1 (options ignored)
 * ```
 */
export function getAuditLogger(options?: AuditLoggerOptions): AuditLogger {
  if (!_auditLogger) {
    _auditLogger = new AuditLogger(options);
  }
  return _auditLogger;
}

/**
 * Resets the audit logger instance.
 *
 * Primarily used for testing to ensure each test gets a fresh logger
 * instance with its own state.
 *
 * @example
 * ```typescript
 * beforeEach(() => {
 *   resetAuditLogger();  // Ensures clean state for each test
 * });
 *
 * test("audit logging", () => {
 *   const logger = getAuditLogger();
 *   // Test audit logging...
 * });
 * ```
 */
export function resetAuditLogger(): void {
  _auditLogger = undefined;
}
