import { z } from "zod";

// Shared Enums with standard default fallback values
const FindingSeveritySchema = z.enum(["critical", "high", "medium", "low"]).catch("medium");

const FindingConfidenceSchema = z.enum(["high", "medium", "low"]).catch("high");

const FileFindingCategorySchema = z
  .enum(["bug", "security", "performance", "quality", "documentation"])
  .catch("quality");

const CrossFileFindingCategorySchema = z
  .enum([
    "architecture",
    "design",
    "testing",
    "documentation",
    "bug",
    "security",
    "performance",
    "quality",
  ])
  .catch("design");

// File-Level Finding Schema
const FileFindingSchema = z.object({
  line: z.coerce.number().int().nonnegative().default(0),
  severity: FindingSeveritySchema,
  confidence: FindingConfidenceSchema,
  category: FileFindingCategorySchema,
  message: z.coerce.string().default(""),
  suggestion: z.coerce.string().default(""),
  reasoning: z.coerce.string().default("Reasoning not provided by the model."),
  isPreExisting: z.boolean().default(false),
});

// Single File Review Schema
export const FileReviewResponseSchema = z.object({
  findings: z.array(FileFindingSchema).default([]),
});

// Cross-File Finding Schema
const CrossFileFindingSchema = z.object({
  severity: FindingSeveritySchema,
  confidence: FindingConfidenceSchema,
  category: CrossFileFindingCategorySchema,
  message: z.coerce.string().default(""),
  reasoning: z.coerce.string().default("Reasoning not provided by the model."),
  affected_files: z.array(z.coerce.string()).default([]),
});

// Cross-File Review Response Schema
export const CrossFileReviewResponseSchema = z.object({
  overall_assessment: z.coerce.string().default("Review completed"),
  findings: z.array(CrossFileFindingSchema).default([]),
  recommendations: z.array(z.coerce.string()).default([]),
});

// Batched File Review Schema
export const BatchedFileReviewResponseSchema = z.object({
  file_results: z.record(z.string(), FileReviewResponseSchema).default({}),
});

// Fast Review (Flat combined findings list)
const FastReviewFindingSchema = FileFindingSchema.extend({
  file: z.coerce.string().optional(),
});

export const FastReviewResponseSchema = z.object({
  summary: z.coerce.string().default("Review completed"),
  findings: z.array(FastReviewFindingSchema).default([]),
});
