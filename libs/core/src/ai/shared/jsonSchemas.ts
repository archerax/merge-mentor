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
          line: {
            type: "number",
            description:
              "Line number in the file, or null when the comment applies to the whole file or is not line-specific",
          },
          start_line: {
            type: "number",
            description:
              "First changed file line replaced by a native suggestion, or null when not applicable",
          },
          end_line: {
            type: "number",
            description:
              "Last changed file line replaced by a native suggestion, or null when not applicable",
          },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
            description: "Finding severity",
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "Confidence level",
          },
          category: {
            type: "string",
            enum: ["bug", "security", "performance", "quality", "documentation"],
            description: "Finding category",
          },
          message: {
            type: "string",
            description: "Description of the finding; must not be empty",
          },
          suggestion: {
            type: "string",
            description: "Suggested fix, or an empty string when there is none",
          },
          replacement: {
            type: "string",
            description:
              "Exact replacement code for a native suggestion, or an empty string when a safe localized replacement is not possible",
          },
          reasoning: {
            type: "string",
            description:
              "Concise rationale citing code evidence, checked context, and impact; empty string when not needed",
          },
          isPreExisting: {
            type: "boolean",
            description: "Whether this issue existed before the PR changes",
          },
        },
        required: ["severity", "category", "message"],
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
            enum: ["critical", "high", "medium", "low"],
            description: "Finding severity",
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "Confidence level",
          },
          category: {
            type: "string",
            enum: [
              "architecture",
              "design",
              "testing",
              "documentation",
              "bug",
              "security",
              "performance",
              "quality",
            ],
            description: "Finding category",
          },
          message: {
            type: "string",
            description: "Description of the finding; must not be empty",
          },
          reasoning: {
            type: "string",
            description:
              "Concise rationale citing cross-file evidence, checked context, and impact; empty string when not needed",
          },
          affected_files: {
            type: "array",
            items: { type: "string" },
            description: "List of affected file paths; empty array when unknown",
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
                line: {
                  type: "number",
                  description:
                    "Line number, or null when the finding applies to the whole file or is not line-specific",
                },
                start_line: { type: "number", description: "Suggestion start line, or null" },
                end_line: { type: "number", description: "Suggestion end line, or null" },
                severity: {
                  type: "string",
                  enum: ["critical", "high", "medium", "low"],
                },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                category: {
                  type: "string",
                  enum: ["bug", "security", "performance", "quality", "documentation"],
                },
                message: { type: "string", description: "Finding description; must not be empty" },
                suggestion: { type: "string", description: "Suggested fix, or empty string" },
                replacement: {
                  type: "string",
                  description: "Native suggestion replacement, or empty string",
                },
                reasoning: { type: "string", description: "Rationale, or empty string" },
                isPreExisting: { type: "boolean" },
              },
              required: ["severity", "category", "message"],
            },
          },
        },
        required: ["findings"],
      },
    },
  },
  required: ["file_results"],
} as const;

/**
 * JSON schema for the fast file review: an entry per changed file (as in the
 * batched review) plus cross-file findings, so the response can account for
 * every file. The multi-agent synthesizer keeps the flat {@link FAST_REVIEW_SCHEMA}.
 */
export const FAST_FILE_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Brief summary of the review" },
    file_results: {
      ...BATCHED_FILE_REVIEW_SCHEMA.properties.file_results,
      description:
        "Map of filename to review results; MUST contain an entry for every changed file, with an empty findings array when a file has no findings",
    },
    cross_file_findings: {
      ...CROSS_FILE_REVIEW_SCHEMA.properties.findings,
      description: "Findings that span multiple files or are not tied to one file",
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
          file: {
            type: "string",
            description: "File path, or an empty string for cross-file/PR-level findings",
          },
          line: {
            type: "number",
            description:
              "Line number, or null for file-level and cross-file findings that are not line-specific",
          },
          start_line: { type: "number", description: "Suggestion start line, or null" },
          end_line: { type: "number", description: "Suggestion end line, or null" },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          category: {
            type: "string",
            enum: [
              "bug",
              "security",
              "performance",
              "quality",
              "documentation",
              "architecture",
              "design",
              "testing",
            ],
          },
          message: { type: "string", description: "Finding description; must not be empty" },
          suggestion: { type: "string", description: "Suggested fix, or empty string" },
          replacement: {
            type: "string",
            description: "Native suggestion replacement, or empty string",
          },
          reasoning: { type: "string", description: "Rationale, or empty string" },
          isPreExisting: { type: "boolean" },
        },
        required: ["severity", "category", "message"],
      },
    },
  },
  required: ["findings"],
} as const;

const BUILD_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    failureType: {
      type: "string",
      enum: ["compilation", "test", "lint", "dependency", "infrastructure", "timeout", "unknown"],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    summary: { type: "string" },
    rootCause: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    affectedFiles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          line: { type: "number" },
          column: { type: "number" },
        },
        required: ["path"],
      },
    },
    recommendations: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
  },
  required: [
    "failureType",
    "confidence",
    "summary",
    "rootCause",
    "evidence",
    "affectedFiles",
    "recommendations",
    "limitations",
  ],
} as const;

/** JSON schema for project/feature plan review structured output. */
export const PROJECT_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Plan title" },
    completeness_assessment: {
      type: "string",
      description: "Prose rollup for plan completeness and scope coverage of the root",
    },
    dependency_risks: {
      type: "string",
      description: "Prose rollup for dependency and sequencing risks",
    },
    acceptance_criteria_alignment: {
      type: "string",
      description: "Prose rollup for acceptance criteria presence and quality",
    },
    estimation_consistency: {
      type: "string",
      description: "Prose rollup for estimation, sizing, and MoSCoW consistency",
    },
    overall_assessment: {
      type: "string",
      description: "Holistic assessment of the project plan health, readiness, and risks",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "Overall confidence in the review",
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          work_item_id: {
            type: "string",
            description:
              "ID of the work item the finding refers to, or empty for plan-level findings",
          },
          dimension: {
            type: "string",
            enum: ["completeness", "dependency", "acceptance_criteria", "estimation"],
            description: "Planning dimension the finding belongs to",
          },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
            description: "Finding severity",
          },
          issue: { type: "string", description: "Description of the issue" },
          recommendation: { type: "string", description: "Actionable recommendation" },
        },
      },
    },
    suggestions: {
      type: "array",
      items: { type: "string" },
      description: "Actionable suggestions",
    },
  },
  required: [
    "completeness_assessment",
    "dependency_risks",
    "acceptance_criteria_alignment",
    "estimation_consistency",
    "overall_assessment",
    "findings",
  ],
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
      return FAST_FILE_REVIEW_SCHEMA as unknown as Record<string, unknown>;
    case "build-analysis":
      return BUILD_ANALYSIS_SCHEMA as unknown as Record<string, unknown>;
    case "project":
      return PROJECT_REVIEW_SCHEMA as unknown as Record<string, unknown>;
    case "multi-agent-synthesizer":
      return FAST_REVIEW_SCHEMA as unknown as Record<string, unknown>;
    default:
      return undefined;
  }
}

/**
 * Numeric finding fields that may be legitimately absent. Provider-strict JSON
 * schema cannot leave a property out (every property must be required), so these
 * are widened to also accept `null`, meaning "not applicable". `line` is included
 * because a comment may apply to a whole file rather than a specific line.
 */
const NULLABLE_NUMERIC_PROPS: ReadonlySet<string> = new Set(["line", "start_line", "end_line"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strictifyProperties(properties: unknown): Record<string, unknown> {
  if (!isRecord(properties)) {
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(properties)) {
    result[name] = strictifySchema(schema, name);
  }
  return result;
}

/**
 * Recursively rewrites a JSON schema into the provider-strict form required by
 * native structured output: every object gets `additionalProperties: false` and
 * lists ALL of its properties in `required`.
 *
 * Crucially, "required" only means the key must be present — it does not mean
 * the value must be non-empty. Optional string fields (e.g. `suggestion`,
 * `replacement`, `reasoning`) therefore remain blankable: the model emits `""`
 * when it has nothing to add, instead of omitting the key or inventing one.
 * Optional numeric fields are widened to accept `null` because numbers cannot be
 * blank.
 */
function strictifySchema(node: unknown, propName?: string): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => strictifySchema(item));
  }
  if (!isRecord(node)) {
    return node;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "required") {
      continue;
    }
    result[key] = key === "properties" ? strictifyProperties(value) : strictifySchema(value, key);
  }

  if (isRecord(node.properties)) {
    result.additionalProperties = false;
    result.required = Object.keys(node.properties);
  }

  if (propName && NULLABLE_NUMERIC_PROPS.has(propName) && node.type === "number") {
    result.type = ["number", "null"];
  }

  return result;
}

/**
 * Returns a provider-strict variant of the JSON schema for the given prompt
 * type, suitable for native structured output enforcement. Returns undefined
 * when the prompt type has no schema or when the schema cannot be represented in
 * strict form (e.g. the batched response uses an open-ended map).
 */
export function getStrictJsonSchema(promptType: PromptType): Record<string, unknown> | undefined {
  const schema = getJsonSchema(promptType);
  if (!schema) {
    return undefined;
  }
  if (containsOpenMap(schema)) {
    return undefined;
  }
  return strictifySchema(schema) as Record<string, unknown>;
}

/**
 * Detects a map-style `additionalProperties` object schema (as opposed to the
 * boolean `false` added by strictify). OpenAI strict mode rejects open-ended
 * maps, so schemas that use them fall back to the non-strict path.
 */
function containsOpenMap(node: unknown): boolean {
  if (Array.isArray(node)) {
    return node.some((item) => containsOpenMap(item));
  }
  if (!isRecord(node)) {
    return false;
  }
  if (isRecord(node.additionalProperties)) {
    return true;
  }
  return Object.values(node).some((value) => containsOpenMap(value));
}
