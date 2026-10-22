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
  start_line: z.preprocess(
    (value) => (value === null || value === 0 ? undefined : value),
    z.coerce.number().int().positive().optional()
  ),
  end_line: z.preprocess(
    (value) => (value === null || value === 0 ? undefined : value),
    z.coerce.number().int().positive().optional()
  ),
  severity: FindingSeveritySchema,
  confidence: FindingConfidenceSchema,
  category: FileFindingCategorySchema,
  message: z.coerce.string().default(""),
  suggestion: z.coerce.string().default(""),
  replacement: z.coerce.string().optional(),
  reasoning: z.coerce.string().default("Reasoning not provided by the model."),
  isPreExisting: z.boolean().default(false),
});

// Single File Review Schema
/** Zod schema validating the single-file review response, with a findings array. */
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
/** Zod schema validating the cross-file review response: overall assessment, findings, and recommendations. */
export const CrossFileReviewResponseSchema = z.object({
  overall_assessment: z.coerce.string().default("Review completed"),
  findings: z.array(CrossFileFindingSchema).default([]),
  recommendations: z.array(z.coerce.string()).default([]),
});

// Review result (shared by the fast, deep and multi-agent strategies)

/** Categories accepted for any finding in a review result (file-level and cross-file). */
const ReviewFindingCategorySchema = z
  .enum([
    "bug",
    "security",
    "performance",
    "quality",
    "documentation",
    "architecture",
    "design",
    "testing",
  ])
  .catch("quality");

/** A file-level finding inside a review result's `file_results` map. */
const ReviewFileFindingSchema = FileFindingSchema.extend({
  category: ReviewFindingCategorySchema,
});

/** Legacy flat finding: file-level when `file` is set, otherwise a cross-file concern. */
const ReviewFlatFindingSchema = ReviewFileFindingSchema.extend({
  file: z.coerce.string().optional(),
  /** Files affected by a cross-file (PR-level) finding. */
  affected_files: z.array(z.coerce.string()).default([]),
});

/**
 * Zod schema validating the review result returned by every review strategy
 * (fast, deep, and the multi-agent subagents and synthesizer): a summary, a
 * `file_results` entry for every changed file (even with no findings, so a
 * missing file is detectable rather than silently treated as clean), and
 * `cross_file_findings` for concerns that span files. A legacy flat `findings`
 * list is still accepted when parsing.
 */
export const ReviewResponseSchema = z.object({
  summary: z.coerce.string().default("Review completed"),
  file_results: z
    .record(z.string(), z.object({ findings: z.array(ReviewFileFindingSchema).default([]) }))
    .default({}),
  cross_file_findings: z.array(CrossFileFindingSchema).default([]),
  findings: z.array(ReviewFlatFindingSchema).default([]),
});

/** Zod schema validating the PBI alignment review response (criteria statuses and assessment). */
export const PBIAlignmentResponseSchema = z.object({
  pbiId: z.coerce.string(),
  title: z.coerce.string(),
  metCriteria: z.array(z.coerce.string()).default([]),
  partialCriteria: z
    .array(
      z.object({
        criterion: z.coerce.string(),
        explanation: z.coerce.string(),
      })
    )
    .default([]),
  missingCriteria: z.array(z.coerce.string()).default([]),
  scopeCreep: z.array(z.coerce.string()).default([]),
  overallAssessment: z.coerce.string().default(""),
});
