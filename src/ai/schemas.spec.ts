import { describe, expect, it } from "vitest";
import {
  BatchedFileReviewResponseSchema,
  CrossFileReviewResponseSchema,
  FastReviewResponseSchema,
  FileReviewResponseSchema,
  PBIAlignmentResponseSchema,
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

  it("defaults empty cross-file, batched, and fast responses", () => {
    expect(CrossFileReviewResponseSchema.parse({})).toEqual({
      overall_assessment: "Review completed",
      findings: [],
      recommendations: [],
    });
    expect(BatchedFileReviewResponseSchema.parse({})).toEqual({ file_results: {} });
    expect(FastReviewResponseSchema.parse({})).toEqual({
      summary: "Review completed",
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

    expect(() => PBIAlignmentResponseSchema.parse({ title: "Missing id" })).toThrow();
  });
});
