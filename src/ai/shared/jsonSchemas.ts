import type { PromptType } from "./promptType.js";

/** JSON schema for file review structured output. */
export const FILE_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "number", description: "Line number in the file" },
          start_line: {
            type: "number",
            description: "First changed file line replaced by a native suggestion (optional)",
          },
          end_line: {
            type: "number",
            description: "Last changed file line replaced by a native suggestion (optional)",
          },
          severity: {
            type: "string",
            description: "Finding severity: critical, high, medium, or low",
          },
          confidence: { type: "string", description: "Confidence level: high, medium, or low" },
          category: {
            type: "string",
            description: "Finding category: bug, security, performance, quality, or documentation",
          },
          message: { type: "string", description: "Description of the finding" },
          suggestion: { type: "string", description: "Suggested fix or improvement" },
          replacement: {
            type: "string",
            description:
              "Exact replacement code for a native suggestion; omit when a safe localized replacement is not possible",
          },
          reasoning: {
            type: "string",
            description: "Concise rationale citing code evidence, checked context, and impact",
          },
          isPreExisting: {
            type: "boolean",
            description: "Whether this issue existed before the PR changes",
          },
        },
        required: ["line", "severity", "category", "message"],
      },
    },
  },
  required: ["findings"],
} as const;

/** JSON schema for cross-file review structured output. */
export const CROSS_FILE_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    overall_assessment: { type: "string", description: "Overall assessment of the PR" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: {
            type: "string",
            description: "Finding severity: critical, high, medium, or low",
          },
          confidence: { type: "string", description: "Confidence level: high, medium, or low" },
          category: {
            type: "string",
            description:
              "Category: architecture, design, testing, documentation, bug, security, performance, or quality",
          },
          message: { type: "string", description: "Description of the finding" },
          reasoning: {
            type: "string",
            description:
              "Concise rationale citing cross-file evidence, checked context, and impact",
          },
          affected_files: {
            type: "array",
            items: { type: "string" },
            description: "List of affected file paths",
          },
        },
        required: ["severity", "category", "message"],
      },
    },
    recommendations: {
      type: "array",
      items: { type: "string" },
      description: "Actionable recommendations",
    },
  },
  required: ["findings"],
} as const;

/** JSON schema for batched file review structured output. */
export const BATCHED_FILE_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    file_results: {
      type: "object",
      description: "Map of filename to review results",
      additionalProperties: {
        type: "object",
        properties: {
          findings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                line: { type: "number" },
                start_line: { type: "number" },
                end_line: { type: "number" },
                severity: { type: "string" },
                confidence: { type: "string" },
                category: { type: "string" },
                message: { type: "string" },
                suggestion: { type: "string" },
                replacement: { type: "string" },
                reasoning: { type: "string" },
                isPreExisting: { type: "boolean" },
              },
              required: ["line", "severity", "category", "message"],
            },
          },
        },
        required: ["findings"],
      },
    },
  },
  required: ["file_results"],
} as const;

/** JSON schema for fast review structured output. */
export const FAST_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Brief summary of the review" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string", description: "File path (omit for cross-file findings)" },
          line: { type: "number", description: "Line number in the file" },
          start_line: { type: "number" },
          end_line: { type: "number" },
          severity: { type: "string" },
          confidence: { type: "string" },
          category: { type: "string" },
          message: { type: "string" },
          suggestion: { type: "string" },
          replacement: { type: "string" },
          reasoning: { type: "string" },
          isPreExisting: { type: "boolean" },
        },
        required: ["severity", "category", "message"],
      },
    },
  },
  required: ["findings"],
} as const;

/**
 * Returns the structured JSON schema corresponding to the prompt type,
 * or undefined if structured schema output is not used for that prompt type.
 */
export function getJsonSchema(promptType: PromptType): Record<string, unknown> | undefined {
  switch (promptType) {
    case "file-review":
      return FILE_REVIEW_SCHEMA as unknown as Record<string, unknown>;
    case "cross-file-review":
      return CROSS_FILE_REVIEW_SCHEMA as unknown as Record<string, unknown>;
    case "batched-file-review":
      return BATCHED_FILE_REVIEW_SCHEMA as unknown as Record<string, unknown>;
    case "fast-review":
      return FAST_REVIEW_SCHEMA as unknown as Record<string, unknown>;
    default:
      return undefined;
  }
}
