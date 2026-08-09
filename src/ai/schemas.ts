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
  start_line: z.coerce.number().int().positive().optional(),
  end_line: z.coerce.number().int().positive().optional(),
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

// Multi-agent review schemas

/** Agent ids selectable by the pre-classifier and agent registry. */
const MultiAgentIdSchema = z.enum([
  "general",
  "security",
  "performance",
  "testing",
  "architecture",
]);

/** Category union shared by multi-agent file findings and synthesized findings. */
const MultiAgentFindingCategorySchema = z
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

/** A finding reported by a specialized subagent or the lead synthesizer. */
const MultiAgentFindingSchema = z.object({
  file: z.coerce.string().optional(),
  line: z.coerce.number().int().nonnegative().default(0),
  start_line: z.coerce.number().int().positive().optional(),
  end_line: z.coerce.number().int().positive().optional(),
  severity: FindingSeveritySchema,
  confidence: FindingConfidenceSchema,
  category: MultiAgentFindingCategorySchema,
  message: z.coerce.string().default(""),
  suggestion: z.coerce.string().default(""),
  replacement: z.coerce.string().optional(),
  reasoning: z.coerce.string().default("Reasoning not provided by the model."),
  isPreExisting: z.boolean().default(false),
  /** Files affected by a cross-file (pr-level) finding. Only used by the synthesizer. */
  affected_files: z.array(z.coerce.string()).default([]),
});

/** Response from the LLM pre-classification pass. */
export const PreClassifierResponseSchema = z.object({
  agents: z.array(MultiAgentIdSchema).default([]),
});

/** Response from a single specialized subagent. */
export const AgentReviewResponseSchema = z.object({
  findings: z.array(MultiAgentFindingSchema).default([]),
});

/** Response from the lead synthesizer (deduplicated, filtered, prioritized). */
export const SynthesizedReviewResponseSchema = z.object({
  overall_assessment: z.coerce.string().default("Review completed"),
  findings: z.array(MultiAgentFindingSchema).default([]),
  recommendations: z.array(z.coerce.string()).default([]),
});
