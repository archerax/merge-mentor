import { describe, expect, it } from "vitest";

import {
  CrossFileReviewResponseSchema,
  FileReviewResponseSchema,
  PBIAlignmentResponseSchema,
  ReviewResponseSchema,
} from "./schemas.js";

describe("AI response schemas", () => {
  it("applies defaults and coerces file findings", () => {
    expect(
      FileReviewResponseSchema.parse({
        findings: [{ line: "4", severity: "invalid", message: 123 }],
      })
    ).toEqual({
      findings: [
        {
          line: 4,
          severity: "medium",
          confidence: "high",
          category: "quality",
          message: "123",
          suggestion: "",
          reasoning: "Reasoning not provided by the model.",
          isPreExisting: false,
        },
      ],
    });
  });

  it("treats null and zero start_line/end_line as absent", () => {
    const parsed = FileReviewResponseSchema.parse({
      findings: [
        {
          line: 10,
          severity: "high",
          category: "bug",
          message: "x",
          start_line: null,
          end_line: 0,
        },
      ],
    });
    expect(parsed.findings[0].start_line).toBeUndefined();
    expect(parsed.findings[0].end_line).toBeUndefined();
  });

  it("treats a null line as a whole-file finding", () => {
    const parsed = FileReviewResponseSchema.parse({
      findings: [{ line: null, severity: "high", category: "bug", message: "Whole file" }],
    });
    expect(parsed.findings[0].line).toBe(0);
  });

  it("defaults empty cross-file and review responses", () => {
    expect(CrossFileReviewResponseSchema.parse({})).toEqual({
      overall_assessment: "Review completed",
      findings: [],
      recommendations: [],
    });
    expect(ReviewResponseSchema.parse({})).toEqual({
      summary: "Review completed",
      file_results: {},
      cross_file_findings: [],
      findings: [],
    });
  });

  it("requires PBI identifiers and defaults optional alignment lists", () => {
    expect(PBIAlignmentResponseSchema.parse({ pbiId: 123, title: "Add feature" })).toEqual({
      pbiId: "123",
      title: "Add feature",
      metCriteria: [],
      partialCriteria: [],
      missingCriteria: [],
      scopeCreep: [],
      overallAssessment: "",
    });

    expect(() => PBIAlignmentResponseSchema.parse({ title: "Missing id" })).toThrow("pbiId");
  });

  it("keeps architecture, design and testing categories on file and cross-file findings", () => {
    const parsed = ReviewResponseSchema.parse({
      file_results: {
        "a.ts": {
          findings: [{ severity: "medium", category: "testing", message: "No test covers this" }],
        },
      },
      cross_file_findings: [{ severity: "high", category: "architecture", message: "Layering" }],
    });

    expect(parsed.file_results["a.ts"].findings[0].category).toBe("testing");
    expect(parsed.cross_file_findings[0].category).toBe("architecture");
  });
});
