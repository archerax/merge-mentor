import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditLogger, getAuditLogger, resetAuditLogger } from "./auditLogger.js";

vi.mock("../logger.js", () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe("AuditLogger", () => {
  beforeEach(() => {
    resetAuditLogger();
  });

  describe("logPRDetailsFetch", () => {
    it("logs successful PR details fetch", () => {
      const logger = new AuditLogger();
      const logEventSpy = vi.spyOn(logger, "logEvent");

      logger.logPRDetailsFetch(123, "github", "success");

      expect(logEventSpy).toHaveBeenCalledWith(
        "pr.details.fetch",
        { type: "pr", id: "123", details: { platform: "github" } },
        "Fetch PR #123 details",
        "success",
        { platform: "github" },
        undefined
      );
    });

    it("logs failed PR details fetch", () => {
      const logger = new AuditLogger();
      const logEventSpy = vi.spyOn(logger, "logEvent");

      logger.logPRDetailsFetch(123, "azure", "failure", "Network timeout");

      expect(logEventSpy).toHaveBeenCalledWith(
        "pr.details.fetch",
        { type: "pr", id: "123", details: { platform: "azure" } },
        "Fetch PR #123 details",
        "failure",
        { platform: "azure" },
        "Network timeout"
      );
    });
  });

  describe("logPRFilesFetch", () => {
    it("logs successful files fetch with count", () => {
      const logger = new AuditLogger();
      const logEventSpy = vi.spyOn(logger, "logEvent");

      logger.logPRFilesFetch(456, "github", 5);

      expect(logEventSpy).toHaveBeenCalledWith(
        "pr.files.fetch",
        { type: "pr", id: "456", details: { platform: "github" } },
        "Fetch files for PR #456",
        "success",
        { platform: "github", filesCount: 5 },
        undefined
      );
    });
  });

  describe("logInlineCommentPost", () => {
    it("logs successful inline comment", () => {
      const logger = new AuditLogger();
      const logEventSpy = vi.spyOn(logger, "logEvent");

      logger.logInlineCommentPost(789, "src/app.ts", 42, "github", "success");

      expect(logEventSpy).toHaveBeenCalledWith(
        "comment.post.inline",
        {
          type: "comment",
          id: "pr-789-src/app.ts-42",
          details: { prNumber: 789, path: "src/app.ts", line: 42, platform: "github" },
        },
        "Post inline comment on PR #789 at src/app.ts:42",
        "success",
        { prNumber: 789, path: "src/app.ts", line: 42, platform: "github" },
        undefined
      );
    });
  });

  describe("logCopilotExecution", () => {
    it("logs successful Copilot execution with model", () => {
      const logger = new AuditLogger();
      const logEventSpy = vi.spyOn(logger, "logEvent");

      logger.logCopilotExecution("file-review", "gpt-4", "success");

      expect(logEventSpy).toHaveBeenCalledWith(
        "copilot.execute",
        { type: "copilot", id: "file-review", details: { model: "gpt-4" } },
        "Execute Copilot prompt: file-review",
        "success",
        { promptType: "file-review", model: "gpt-4" },
        undefined
      );
    });
  });

  describe("logReviewComplete", () => {
    it("logs successful review with stats", () => {
      const logger = new AuditLogger();
      const logEventSpy = vi.spyOn(logger, "logEvent");

      logger.logReviewComplete(123, "github", 10, 2, 5, 3, 1, 0);

      expect(logEventSpy).toHaveBeenCalledWith(
        "review.complete",
        { type: "review", id: "pr-123", details: { platform: "github" } },
        "Complete review of PR #123",
        "success",
        {
          prNumber: 123,
          platform: "github",
          filesReviewed: 10,
          filesSkipped: 2,
          commentsCreated: 5,
          commentsUpdated: 3,
          commentsResolved: 1,
          commentErrors: 0,
        }
      );
    });

    it("logs partial result when there are errors", () => {
      const logger = new AuditLogger();
      const logEventSpy = vi.spyOn(logger, "logEvent");

      logger.logReviewComplete(123, "github", 10, 2, 5, 3, 1, 2);

      expect(logEventSpy).toHaveBeenCalledWith(
        "review.complete",
        { type: "review", id: "pr-123", details: { platform: "github" } },
        "Complete review of PR #123",
        "partial",
        expect.objectContaining({
          commentErrors: 2,
        })
      );
    });
  });

  describe("logFileReviewComplete", () => {
    it("logs successful file review", () => {
      const logger = new AuditLogger();
      const logEventSpy = vi.spyOn(logger, "logEvent");

      logger.logFileReviewComplete("src/app.ts", 123, 3, "success");

      expect(logEventSpy).toHaveBeenCalledWith(
        "file.review.complete",
        { type: "file", id: "src/app.ts", details: { prNumber: 123 } },
        "Complete reviewing file: src/app.ts",
        "success",
        { filename: "src/app.ts", prNumber: 123, findingsCount: 3 },
        undefined
      );
    });
  });

  describe("getAuditLogger", () => {
    it("returns singleton instance", () => {
      const logger1 = getAuditLogger();
      const logger2 = getAuditLogger();

      expect(logger1).toBe(logger2);
    });

    it("creates new instance after reset", () => {
      const logger1 = getAuditLogger();
      resetAuditLogger();
      const logger2 = getAuditLogger();

      expect(logger1).not.toBe(logger2);
    });
  });

  describe("disabled logger", () => {
    it("does not log when disabled", () => {
      const logger = new AuditLogger({ enabled: false });
      const logEventSpy = vi.spyOn(logger, "logEvent");

      logger.logPRDetailsFetch(123, "github", "success");

      expect(logEventSpy).toHaveBeenCalledOnce();
    });
  });

  describe("custom actor", () => {
    it("uses custom actor name", () => {
      const logger = new AuditLogger({ actor: "custom-bot" });
      const logEventSpy = vi.spyOn(logger, "logEvent");

      logger.logPRDetailsFetch(123, "github", "success");

      expect(logEventSpy).toHaveBeenCalledWith(
        "pr.details.fetch",
        expect.any(Object),
        expect.any(String),
        "success",
        expect.any(Object),
        undefined
      );
    });
  });
});
