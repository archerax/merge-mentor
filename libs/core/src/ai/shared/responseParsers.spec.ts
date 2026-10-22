import { describe, expect, it, vi } from "vitest";

import {
  parseAgentReview,
  parseBatchedFileReview,
  parseCrossFileReview,
  parseFastReview,
  parseFileReview,
  parseSynthesizedReview,
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
    expect(result.reviewedFiles).toEqual(["main.ts"]);
  });

  it("parseFastReview reports files with an entry in file_results, even without findings", () => {
    const result = parseFastReview(mockLogger, {
      raw: "",
      parsed: {
        summary: "Done",
        file_results: {
          "a.ts": {
            findings: [
              {
                line: 3,
                severity: "high",
                confidence: "high",
                category: "bug",
                message: "Bug",
                reasoning:
                  "Unchecked value flows into a call and throws at runtime on the added line.",
              },
            ],
          },
          "b.ts": { findings: [] },
        },
        cross_file_findings: [
          {
            severity: "medium",
            confidence: "high",
            category: "architecture",
            message: "Inconsistent error handling across modules",
            reasoning: "Callers in a.ts and b.ts handle failures differently, hiding errors.",
          },
        ],
      },
    });

    expect(result.reviewedFiles).toEqual(["a.ts", "b.ts"]);
    expect(result.fileResults.map((r) => r.filename)).toEqual(["a.ts", "b.ts"]);
    expect(result.fileResults[0].findings).toHaveLength(1);
    expect(result.crossFileResult.findings).toHaveLength(1);
  });

  it("parseFastReview keeps cross-file categories and affected files from cross_file_findings", () => {
    const result = parseFastReview(mockLogger, {
      raw: "",
      parsed: {
        summary: "Done",
        file_results: { "a.ts": { findings: [] } },
        cross_file_findings: [
          {
            severity: "high",
            confidence: "high",
            category: "architecture",
            message: "Layering violation",
            reasoning: "The controller calls the repository directly, bypassing the service layer.",
            affected_files: ["a.ts", "b.ts"],
          },
          {
            severity: "medium",
            confidence: "high",
            category: "testing",
            message: "No test covers the new branch",
            reasoning: "The added branch in a.ts has no corresponding test in the PR.",
            affected_files: ["a.ts"],
          },
        ],
      },
    });

    expect(result.crossFileResult.findings.map((f) => f.category)).toEqual([
      "architecture",
      "testing",
    ]);
    expect(result.crossFileResult.findings[0].affectedFiles).toEqual(["a.ts", "b.ts"]);
  });

  it("parseAgentReview splits file and cross-file findings", () => {
    const response = {
      raw: "",
      parsed: {
        findings: [
          {
            file: "auth.ts",
            line: 12,
            severity: "high",
            confidence: "high",
            category: "security",
            message: "SQL injection risk",
            suggestion: "Use parameterized queries",
            reasoning:
              "User input is concatenated into a SQL query on an added line, enabling injection.",
          },
          {
            severity: "high",
            confidence: "high",
            category: "architecture",
            message: "PR-level concern spanning multiple files",
            reasoning:
              "Callers across multiple modules break the API contract; system-level impact.",
            affected_files: ["auth.ts", "api.ts"],
          },
        ],
      },
    };

    const findings = parseAgentReview(mockLogger, response);

    expect(findings).toHaveLength(2);
    expect(findings[0].file).toBe("auth.ts");
    expect(findings[0].line).toBe(12);
    expect(findings[0].category).toBe("security");
    expect(findings[1].file).toBeUndefined();
    expect(findings[1].affectedFiles).toEqual(["auth.ts", "api.ts"]);
    expect(findings[1].category).toBe("architecture");
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "PR-level concern spanning multiple files" }),
      "Subagent finding missing file attribution - dropped from agent output"
    );
  });

  it("parseSynthesizedReview splits file and cross-file findings", () => {
    const response = {
      raw: "",
      parsed: {
        overall_assessment: "Solid PR with minor concerns.",
        findings: [
          {
            file: "auth.ts",
            line: 12,
            severity: "high",
            confidence: "high",
            category: "security",
            message: "SQL injection risk",
            suggestion: "Use parameterized queries",
            reasoning:
              "User input is concatenated into a SQL query on an added line, enabling injection.",
          },
          {
            severity: "high",
            confidence: "high",
            category: "architecture",
            message: "Layering violation across modules",
            reasoning:
              "The new module reaches across layers on added lines, coupling presentation to data access.",
            affected_files: ["auth.ts", "db.ts"],
          },
        ],
        recommendations: ["Add integration tests"],
      },
    };

    const result = parseSynthesizedReview(mockLogger, response);

    expect(result.overallAssessment).toBe("Solid PR with minor concerns.");
    expect(result.fileResults).toHaveLength(1);
    expect(result.fileResults[0].filename).toBe("auth.ts");
    expect(result.fileResults[0].findings[0].line).toBe(12);
    expect(result.crossFileResult.findings).toHaveLength(1);
    expect(result.crossFileResult.findings[0].affectedFiles).toEqual(["auth.ts", "db.ts"]);
    expect(result.crossFileResult.recommendations).toEqual(["Add integration tests"]);
  });

  it("warns on schema drift for every parser and falls back to defaults", () => {
    const logger = { warn: vi.fn() };

    expect(parseFileReview(logger, "a.ts", { raw: "", parsed: { findings: "nope" } })).toEqual({
      filename: "a.ts",
      findings: [],
    });
    expect(parseCrossFileReview(logger, { raw: "", parsed: { findings: "nope" } })).toEqual({
      overallAssessment: "Review completed",
      findings: [],
      recommendations: [],
    });
    expect(parseBatchedFileReview(logger, { raw: "", parsed: { file_results: "nope" } })).toEqual(
      []
    );
    expect(parseFastReview(logger, { raw: "", parsed: { findings: "nope" } })).toEqual({
      fileResults: [],
      crossFileResult: {
        overallAssessment: "Review completed",
        findings: [],
        recommendations: [],
      },
      reviewedFiles: [],
    });
    expect(parseAgentReview(logger, { raw: "", parsed: { findings: "nope" } })).toEqual([]);
    expect(parseSynthesizedReview(logger, { raw: "", parsed: { findings: "nope" } })).toEqual({
      overallAssessment: "Review completed",
      fileResults: [],
      crossFileResult: {
        overallAssessment: "Review completed",
        findings: [],
        recommendations: [],
      },
    });

    expect(logger.warn.mock.calls.map((call) => call[1])).toEqual([
      "File review schema drift detected",
      "Cross-file review schema drift detected",
      "Batched file review schema drift detected",
      "Fast review schema drift detected",
      "Subagent review schema drift detected",
      "Synthesizer review schema drift detected",
    ]);
  });
});
