import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as logger from "../../logger.js";
import type { AIResponse } from "../types.js";
import { CopilotProvider } from "./copilot.js";
import { OpenCodeProvider } from "./opencode.js";

describe("AI Provider Reasoning Validation", () => {
  let loggerWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    loggerWarnSpy = vi.spyOn(logger, "createChildLogger").mockReturnValue({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as ReturnType<typeof logger.createChildLogger>);
  });

  afterEach(() => {
    loggerWarnSpy.mockRestore();
  });

  function getWarnMock(): ReturnType<typeof vi.fn> {
    const childLogger = loggerWarnSpy.mock.results[0]?.value;
    return childLogger?.warn as ReturnType<typeof vi.fn>;
  }

  function createFileReviewResponse(reasoning: string): AIResponse {
    return {
      raw: JSON.stringify({
        findings: [
          {
            line: 45,
            severity: "high",
            confidence: "high",
            category: "bug",
            message: "Issue found",
            suggestion: "Fix it",
            reasoning,
            isPreExisting: false,
          },
        ],
      }),
      parsed: {
        findings: [
          {
            line: 45,
            severity: "high",
            confidence: "high",
            category: "bug",
            message: "Issue found",
            suggestion: "Fix it",
            reasoning,
            isPreExisting: false,
          },
        ],
      },
    };
  }

  describe("CopilotProvider", () => {
    it("logs warning for short reasoning in file review", () => {
      const provider = new CopilotProvider();

      provider.parseFileReview("test.ts", createFileReviewResponse("Too short"));

      const warnMock = getWarnMock();
      expect(warnMock).toHaveBeenCalled();
      const hasShortWarning = warnMock.mock.calls.some((call) =>
        call.some((arg: unknown) =>
          typeof arg === "string" ? arg.includes("too short") || arg.includes("20+") : false
        )
      );
      expect(hasShortWarning).toBe(true);
    });

    it("logs warning when reasoning lacks concrete impact", () => {
      const provider = new CopilotProvider();

      provider.parseFileReview(
        "test.ts",
        createFileReviewResponse(
          "The query concatenates req.body.userId directly into the SQL string in this handler."
        )
      );

      const warnMock = getWarnMock();
      expect(warnMock).toHaveBeenCalled();
      const hasEvidenceImpactWarning = warnMock.mock.calls.some((call) =>
        call.some((arg: unknown) =>
          typeof arg === "string"
            ? arg.includes("code evidence") || arg.includes("concrete impact")
            : false
        )
      );
      expect(hasEvidenceImpactWarning).toBe(true);
    });

    it("does not log warning for concise reasoning with evidence and impact", () => {
      const provider = new CopilotProvider();

      provider.parseFileReview(
        "test.ts",
        createFileReviewResponse(
          "Line 45 uses req.body.userId in the SQL query, which can allow injection and bypass tenant scoping."
        )
      );

      expect(getWarnMock()).not.toHaveBeenCalled();
    });

    it("validates reasoning in batched file review", () => {
      const provider = new CopilotProvider();
      const response: AIResponse = {
        raw: JSON.stringify({
          file_results: {
            "test.ts": {
              findings: [
                {
                  line: 45,
                  severity: "high",
                  confidence: "high",
                  category: "bug",
                  message: "Issue",
                  suggestion: "Fix",
                  reasoning: "Short",
                  isPreExisting: false,
                },
              ],
            },
          },
        }),
        parsed: {
          file_results: {
            "test.ts": {
              findings: [
                {
                  line: 45,
                  severity: "high",
                  confidence: "high",
                  category: "bug",
                  message: "Issue",
                  suggestion: "Fix",
                  reasoning: "Short",
                  isPreExisting: false,
                },
              ],
            },
          },
        },
      };

      provider.parseBatchedFileReview(response);

      expect(getWarnMock()).toHaveBeenCalled();
    });

    it("validates reasoning in cross-file review", () => {
      const provider = new CopilotProvider();
      const response: AIResponse = {
        raw: JSON.stringify({
          overall_assessment: "Review complete",
          findings: [
            {
              severity: "high",
              confidence: "high",
              category: "architecture",
              message: "Architectural issue",
              reasoning:
                "AuthMiddleware.ts and AdminRoutes.ts diverge in how they wire the middleware.",
              affected_files: ["file1.ts", "file2.ts"],
            },
          ],
          recommendations: [],
        }),
        parsed: {
          overall_assessment: "Review complete",
          findings: [
            {
              severity: "high",
              confidence: "high",
              category: "architecture",
              message: "Architectural issue",
              reasoning:
                "AuthMiddleware.ts and AdminRoutes.ts diverge in how they wire the middleware.",
              affected_files: ["file1.ts", "file2.ts"],
            },
          ],
          recommendations: [],
        },
      };

      provider.parseCrossFileReview(response);

      expect(getWarnMock()).toHaveBeenCalled();
    });
  });

  describe("OpenCodeProvider", () => {
    it("validates reasoning quality in file review", () => {
      const provider = new OpenCodeProvider();

      provider.parseFileReview("test.ts", createFileReviewResponse("Bad"));

      expect(getWarnMock()).toHaveBeenCalled();
    });

    it("accepts concise reasoning with evidence and impact", () => {
      const provider = new OpenCodeProvider();

      provider.parseFileReview(
        "test.ts",
        createFileReviewResponse(
          "The request path skips the validation guard here, which can return incorrect data for unauthorized callers."
        )
      );

      expect(getWarnMock()).not.toHaveBeenCalled();
    });
  });

  describe("Evidence and impact heuristics", () => {
    it("accepts reasoning that cites a line and runtime failure", () => {
      const provider = new CopilotProvider();

      provider.parseFileReview(
        "test.ts",
        createFileReviewResponse(
          "Line 12 dereferences config.user without a guard, which can crash when the optional config is missing."
        )
      );

      expect(getWarnMock()).not.toHaveBeenCalled();
    });

    it("accepts reasoning that cites a query and security risk", () => {
      const provider = new CopilotProvider();

      provider.parseFileReview(
        "test.ts",
        createFileReviewResponse(
          "The SQL query uses request input directly, which can allow injection against the user table."
        )
      );

      expect(getWarnMock()).not.toHaveBeenCalled();
    });

    it("warns when reasoning states impact without code evidence", () => {
      const provider = new CopilotProvider();

      provider.parseFileReview(
        "test.ts",
        createFileReviewResponse(
          "This can break production behavior for users in a very serious way."
        )
      );

      expect(getWarnMock()).toHaveBeenCalled();
    });
  });
});
