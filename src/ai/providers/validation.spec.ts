import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as logger from "../../logger.js";
import type { AIResponse } from "../types.js";
import { CopilotProvider } from "./copilot.js";
import { CursorProvider } from "./cursor.js";
import { OpenCodeProvider } from "./opencode.js";

describe("AI Provider Reasoning Validation", () => {
  let loggerWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock the logger's warn method
    loggerWarnSpy = vi.spyOn(logger, "createChildLogger").mockReturnValue({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as any);
  });

  afterEach(() => {
    loggerWarnSpy.mockRestore();
  });

  const getWarnMock = () => {
    const childLogger = loggerWarnSpy.mock.results[0]?.value;
    return childLogger?.warn as ReturnType<typeof vi.fn>;
  };

  describe("CopilotProvider", () => {
    it("logs warning for short reasoning in file review", () => {
      const provider = new CopilotProvider();
      const response: AIResponse = {
        raw: JSON.stringify({
          findings: [
            {
              line: 45,
              severity: "high",
              confidence: "high",
              category: "bug",
              message: "Issue found",
              suggestion: "Fix it",
              reasoning: "Too short", // Less than 50 characters
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
              reasoning: "Too short",
              isPreExisting: false,
            },
          ],
        },
      };

      provider.parseFileReview("test.ts", response);

      // Should have logged warning about short reasoning
      const warnMock = getWarnMock();
      expect(warnMock).toHaveBeenCalled();
      const warnCalls = warnMock.mock.calls;
      const hasShortWarning = warnCalls.some((call) =>
        call.some((arg: any) =>
          typeof arg === "string" ? arg.includes("too short") || arg.includes("50+") : false
        )
      );
      expect(hasShortWarning).toBe(true);
    });

    it("logs warning for reasoning without verification keywords", () => {
      const provider = new CopilotProvider();
      const response: AIResponse = {
        raw: JSON.stringify({
          findings: [
            {
              line: 45,
              severity: "high",
              confidence: "high",
              category: "bug",
              message: "Issue found",
              suggestion: "Fix it",
              reasoning:
                "This is a long enough reasoning string but it lacks verification keywords like the ones we are looking for in proper review reasoning.",
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
              reasoning:
                "This is a long enough reasoning string but it lacks verification keywords like the ones we are looking for in proper review reasoning.",
              isPreExisting: false,
            },
          ],
        },
      };

      provider.parseFileReview("test.ts", response);

      // Should have logged warning about missing verification keywords
      const warnMock = getWarnMock();
      expect(warnMock).toHaveBeenCalled();
      const warnCalls = warnMock.mock.calls;
      const hasKeywordWarning = warnCalls.some((call: any[]) =>
        call.some((arg: any) =>
          typeof arg === "string"
            ? arg.includes("verification keywords") || arg.includes("verified/checked")
            : false
        )
      );
      expect(hasKeywordWarning).toBe(true);
    });

    it("does not log warning for proper reasoning with verification", () => {
      const provider = new CopilotProvider();
      const response: AIResponse = {
        raw: JSON.stringify({
          findings: [
            {
              line: 45,
              severity: "high",
              confidence: "high",
              category: "bug",
              message: "Array access without bounds check",
              suggestion: "Add bounds check",
              reasoning:
                "✓ Confirmed line 45: users[index] access without validation. ✓ Scanned lines 40-50: no bounds checking. ✓ Verified impact: runtime error possible.",
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
              message: "Array access without bounds check",
              suggestion: "Add bounds check",
              reasoning:
                "✓ Confirmed line 45: users[index] access without validation. ✓ Scanned lines 40-50: no bounds checking. ✓ Verified impact: runtime error possible.",
              isPreExisting: false,
            },
          ],
        },
      };

      provider.parseFileReview("test.ts", response);

      // Should NOT log any warnings for proper reasoning
      const warnMock = getWarnMock();
      expect(warnMock).not.toHaveBeenCalled();
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
                  reasoning: "Short", // Should trigger warning
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

      const warnMock = getWarnMock();
      expect(warnMock).toHaveBeenCalled();
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
              reasoning: "Too short and unverified", // Less than 50 chars, no keywords
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
              reasoning: "Too short and unverified",
              affected_files: ["file1.ts", "file2.ts"],
            },
          ],
          recommendations: [],
        },
      };

      provider.parseCrossFileReview(response);

      const warnMock = getWarnMock();
      // Should log at least one warning (either for short reasoning or missing keywords)
      expect(warnMock).toHaveBeenCalled();
    });
  });

  describe("OpenCodeProvider", () => {
    it("validates reasoning quality in file review", () => {
      const provider = new OpenCodeProvider();
      const response: AIResponse = {
        raw: JSON.stringify({
          findings: [
            {
              line: 45,
              severity: "high",
              confidence: "high",
              category: "bug",
              message: "Issue",
              suggestion: "Fix",
              reasoning: "Bad", // Too short
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
              message: "Issue",
              suggestion: "Fix",
              reasoning: "Bad",
              isPreExisting: false,
            },
          ],
        },
      };

      provider.parseFileReview("test.ts", response);

      expect(getWarnMock()).toHaveBeenCalled();
    });

    it("accepts proper reasoning with verification keywords", () => {
      const provider = new OpenCodeProvider();
      const response: AIResponse = {
        raw: JSON.stringify({
          findings: [
            {
              line: 45,
              severity: "high",
              confidence: "high",
              category: "security",
              message: "SQL injection risk",
              suggestion: "Use parameterized query",
              reasoning:
                "Checked line 45 and confirmed SQL concatenation. Verified no sanitization in lines 40-50. Scanned for validation utilities and found none applied.",
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
              category: "security",
              message: "SQL injection risk",
              suggestion: "Use parameterized query",
              reasoning:
                "Checked line 45 and confirmed SQL concatenation. Verified no sanitization in lines 40-50. Scanned for validation utilities and found none applied.",
              isPreExisting: false,
            },
          ],
        },
      };

      provider.parseFileReview("test.ts", response);

      expect(getWarnMock()).not.toHaveBeenCalled();
    });
  });

  describe("CursorProvider", () => {
    it("validates reasoning quality in file review", () => {
      const provider = new CursorProvider();
      const response: AIResponse = {
        raw: JSON.stringify({
          findings: [
            {
              line: 45,
              severity: "high",
              confidence: "high",
              category: "bug",
              message: "Issue",
              suggestion: "Fix",
              reasoning: "Wrong", // Too short
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
              message: "Issue",
              suggestion: "Fix",
              reasoning: "Wrong",
              isPreExisting: false,
            },
          ],
        },
      };

      provider.parseFileReview("test.ts", response);

      expect(getWarnMock()).toHaveBeenCalled();
    });

    it("accepts reasoning with checkmark verification format", () => {
      const provider = new CursorProvider();
      const response: AIResponse = {
        raw: JSON.stringify({
          findings: [
            {
              line: 78,
              severity: "medium",
              confidence: "high",
              category: "quality",
              message: "Use const instead of let",
              suggestion: "Change to const",
              reasoning:
                "✓ Confirmed line 78: let declaration for immutable value. ✓ Scanned usage: never reassigned. ✓ Checked codebase pattern: const preferred.",
              isPreExisting: false,
            },
          ],
        }),
        parsed: {
          findings: [
            {
              line: 78,
              severity: "medium",
              confidence: "high",
              category: "quality",
              message: "Use const instead of let",
              suggestion: "Change to const",
              reasoning:
                "✓ Confirmed line 78: let declaration for immutable value. ✓ Scanned usage: never reassigned. ✓ Checked codebase pattern: const preferred.",
              isPreExisting: false,
            },
          ],
        },
      };

      provider.parseFileReview("test.ts", response);

      expect(getWarnMock()).not.toHaveBeenCalled();
    });
  });

  describe("Verification Keywords", () => {
    it("recognizes 'verified' keyword", () => {
      const provider = new CopilotProvider();
      const response: AIResponse = {
        raw: "",
        parsed: {
          findings: [
            {
              line: 1,
              severity: "high",
              confidence: "high",
              category: "bug",
              message: "Test",
              suggestion: "Fix",
              reasoning:
                "I have verified this is a real issue by checking the surrounding code and the impact is significant.",
              isPreExisting: false,
            },
          ],
        },
      };

      provider.parseFileReview("test.ts", response);
      expect(getWarnMock()).not.toHaveBeenCalled();
    });

    it("recognizes 'checked' keyword", () => {
      const provider = new CopilotProvider();
      const response: AIResponse = {
        raw: "",
        parsed: {
          findings: [
            {
              line: 1,
              severity: "high",
              confidence: "high",
              category: "bug",
              message: "Test",
              suggestion: "Fix",
              reasoning:
                "I checked the code thoroughly and confirmed this is an issue that needs to be addressed immediately.",
              isPreExisting: false,
            },
          ],
        },
      };

      provider.parseFileReview("test.ts", response);
      expect(getWarnMock()).not.toHaveBeenCalled();
    });

    it("recognizes 'confirmed' keyword", () => {
      const provider = new CopilotProvider();
      const response: AIResponse = {
        raw: "",
        parsed: {
          findings: [
            {
              line: 1,
              severity: "high",
              confidence: "high",
              category: "bug",
              message: "Test",
              suggestion: "Fix",
              reasoning:
                "After analysis I confirmed this bug exists and the severity is appropriately rated as high impact.",
              isPreExisting: false,
            },
          ],
        },
      };

      provider.parseFileReview("test.ts", response);
      expect(getWarnMock()).not.toHaveBeenCalled();
    });

    it("recognizes 'scanned' keyword", () => {
      const provider = new CopilotProvider();
      const response: AIResponse = {
        raw: "",
        parsed: {
          findings: [
            {
              line: 1,
              severity: "high",
              confidence: "high",
              category: "bug",
              message: "Test",
              suggestion: "Fix",
              reasoning:
                "I scanned the entire function and the surrounding context to ensure this is a genuine issue.",
              isPreExisting: false,
            },
          ],
        },
      };

      provider.parseFileReview("test.ts", response);
      expect(getWarnMock()).not.toHaveBeenCalled();
    });

    it("is case-insensitive for verification keywords", () => {
      const provider = new CopilotProvider();
      const response: AIResponse = {
        raw: "",
        parsed: {
          findings: [
            {
              line: 1,
              severity: "high",
              confidence: "high",
              category: "bug",
              message: "Test",
              suggestion: "Fix",
              reasoning:
                "VERIFIED the issue exists. CHECKED surrounding code. CONFIRMED the impact. SCANNED for alternatives.",
              isPreExisting: false,
            },
          ],
        },
      };

      provider.parseFileReview("test.ts", response);
      expect(getWarnMock()).not.toHaveBeenCalled();
    });
  });
});
