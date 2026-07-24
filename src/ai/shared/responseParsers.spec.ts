import { describe, expect, it, vi } from "vitest";
import {
  parseBatchedFileReview,
  parseCrossFileReview,
  parseFastReview,
  parseFileReview,
} from "./responseParsers.js";

describe("responseParsers", () => {
  const mockLogger = {
    warn: vi.fn(),
  };

  it("parseFileReview parses valid response and validates reasoning without class context", () => {
    const response = {
      raw: "",
      parsed: {
        findings: [
          {
            line: 10,
            severity: "high",
            confidence: "high",
            category: "security",
            message: "Unchecked SQL query parameter",
            suggestion: "Use parameterized query",
            reasoning:
              "The input parameter user_id is concatenated directly into the query string without validation, causing SQL injection risks.",
          },
        ],
      },
    };

    const result = parseFileReview(mockLogger, "db.ts", response);

    expect(result.filename).toBe("db.ts");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].line).toBe(10);
    expect(result.findings[0].severity).toBe("high");
  });

  it("parseCrossFileReview parses valid response", () => {
    const response = {
      raw: "",
      parsed: {
        overall_assessment: "Good overall architecture",
        findings: [
          {
            severity: "medium",
            confidence: "high",
            category: "architecture",
            message: "Tight coupling between services",
            reasoning:
              "Direct class instantiation between auth and audit services creates tight coupling across service boundaries.",
            affected_files: ["auth.ts", "audit.ts"],
          },
        ],
        recommendations: ["Use interface injection"],
      },
    };

    const result = parseCrossFileReview(mockLogger, response);

    expect(result.overallAssessment).toBe("Good overall architecture");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].affectedFiles).toEqual(["auth.ts", "audit.ts"]);
    expect(result.recommendations).toEqual(["Use interface injection"]);
  });

  it("parseBatchedFileReview parses valid batched response", () => {
    const response = {
      raw: "",
      parsed: {
        file_results: {
          "a.ts": {
            findings: [
              {
                line: 5,
                severity: "low",
                confidence: "medium",
                category: "quality",
                message: "Magic number used",
                suggestion: "Extract constant",
                reasoning:
                  "Magic number 42 is used directly in calculation loop without named constant definition.",
              },
            ],
          },
        },
      },
    };

    const results = parseBatchedFileReview(mockLogger, response);

    expect(results).toHaveLength(1);
    expect(results[0].filename).toBe("a.ts");
    expect(results[0].findings[0].line).toBe(5);
  });

  it("parseFastReview parses valid fast review response", () => {
    const response = {
      raw: "",
      parsed: {
        summary: "Fast review completed",
        findings: [
          {
            file: "main.ts",
            line: 12,
            severity: "high",
            confidence: "high",
            category: "bug",
            message: "Null pointer dereference",
            suggestion: "Add optional chaining",
            reasoning:
              "Property access on potential undefined state parameter can crash execution at runtime.",
          },
        ],
      },
    };

    const result = parseFastReview(mockLogger, response);

    expect(result.crossFileResult.overallAssessment).toBe("Fast review completed");
    expect(result.fileResults).toHaveLength(1);
    expect(result.fileResults[0].filename).toBe("main.ts");
  });
});
