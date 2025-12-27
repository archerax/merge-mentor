import { createChildLogger } from "../logger.js";

/** Audit event types for security and compliance tracking. */
export type AuditEventType =
  | "pr.details.fetch"
  | "pr.files.fetch"
  | "pr.comments.fetch"
  | "comment.post.inline"
  | "comment.post.general"
  | "comment.update"
  | "comment.resolve"
  | "copilot.execute"
  | "review.start"
  | "review.complete"
  | "file.review.start"
  | "file.review.complete"
  | "crossfile.review.start"
  | "crossfile.review.complete";

/** Audit event severity levels. */
export type AuditSeverity = "info" | "warn" | "error";

/** Base audit event structure. */
export interface AuditEvent {
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

/** Resource being acted upon. */
export interface AuditResource {
  readonly type: "pr" | "file" | "comment" | "copilot" | "review";
  readonly id: string;
  readonly details?: Record<string, unknown>;
}

/** Options for audit logger configuration. */
export interface AuditLoggerOptions {
  readonly enabled?: boolean;
  readonly actor?: string;
}

/**
 * Audit logger for security and compliance tracking.
 * Logs all critical actions taken by the application.
 */
export class AuditLogger {
  private readonly logger = createChildLogger({ component: "AuditLogger" });
  private readonly enabled: boolean;
  private readonly actor: string;

  constructor(options?: AuditLoggerOptions) {
    this.enabled = options?.enabled ?? true;
    this.actor = options?.actor ?? "merge-mentor-bot";
  }

  /**
   * Logs an audit event.
   *
   * @param eventType - Type of event being logged
   * @param resource - Resource being acted upon
   * @param action - Description of the action
   * @param result - Outcome of the action
   * @param metadata - Additional context
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
      timestamp: new Date().toISOString(),
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
   */
  logGeneralCommentPost(
    prNumber: number,
    platform: string,
    result: "success" | "failure",
    error?: string
  ): void {
    this.logEvent(
      "comment.post.general",
      { type: "comment", id: `pr-${prNumber}-general`, details: { prNumber, platform } },
      `Post general comment on PR #${prNumber}`,
      result,
      { prNumber, platform },
      error
    );
  }

  /**
   * Logs comment update operation.
   */
  logCommentUpdate(
    commentId: number | string,
    prNumber: number,
    platform: string,
    result: "success" | "failure",
    error?: string
  ): void {
    this.logEvent(
      "comment.update",
      { type: "comment", id: commentId.toString(), details: { prNumber, platform } },
      `Update comment ${commentId} on PR #${prNumber}`,
      result,
      { commentId, prNumber, platform },
      error
    );
  }

  /**
   * Logs comment resolve operation.
   */
  logCommentResolve(
    commentId: number | string,
    prNumber: number,
    platform: string,
    result: "success" | "failure",
    error?: string
  ): void {
    this.logEvent(
      "comment.resolve",
      { type: "comment", id: commentId.toString(), details: { prNumber, platform } },
      `Resolve comment ${commentId} on PR #${prNumber}`,
      result,
      { commentId, prNumber, platform },
      error
    );
  }

  /**
   * Logs Copilot CLI execution.
   */
  logCopilotExecution(
    promptType: string,
    model?: string,
    result: "success" | "failure" = "success",
    error?: string
  ): void {
    this.logEvent(
      "copilot.execute",
      { type: "copilot", id: promptType, details: { model } },
      `Execute Copilot prompt: ${promptType}`,
      result,
      { promptType, model },
      error
    );
  }

  /**
   * Logs review start.
   */
  logReviewStart(prNumber: number, platform: string, runs: number): void {
    this.logEvent(
      "review.start",
      { type: "review", id: `pr-${prNumber}`, details: { platform } },
      `Start review of PR #${prNumber}`,
      "success",
      { prNumber, platform, runs }
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
    commentsUpdated: number,
    commentsResolved: number,
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
        commentsUpdated,
        commentsResolved,
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
 * Gets or creates the audit logger instance.
 */
export function getAuditLogger(options?: AuditLoggerOptions): AuditLogger {
  if (!_auditLogger) {
    _auditLogger = new AuditLogger(options);
  }
  return _auditLogger;
}

/**
 * Resets the audit logger instance.
 * Primarily used for testing.
 */
export function resetAuditLogger(): void {
  _auditLogger = undefined;
}
