import type { ToolInvocation, ToolResultObject } from "@github/copilot-sdk";
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import type { FileFinding } from "../../platforms/types.js";
import { consoleOutputWriter, type OutputWriter } from "../../ports/index.js";

/** Zod schema validating the arguments accepted by the postComment tool. */
export const PostCommentArgsSchema = z.object({
  file: z.string().describe("Relative path to file in the repository"),
  line: z.coerce.number().int().positive().describe("Line number in the file (1-indexed)"),
  body: z.string().describe("Review comment text, supporting markdown formatting"),
  severity: z.enum(["critical", "high", "medium", "low"]).describe("Finding severity level"),
  category: z
    .enum(["bug", "security", "performance", "quality", "documentation"])
    .describe("Finding category"),
  confidence: z.enum(["high", "medium", "low"]).optional().describe("Finding confidence rating"),
  suggestion: z.string().optional().describe("Suggested code replacement or fix"),
  reasoning: z
    .string()
    .optional()
    .describe("Internal analysis/justification citing code evidence and concrete impact"),
});

/** Inferred argument type accepted by the postComment tool. */
export type PostCommentArgs = z.infer<typeof PostCommentArgsSchema>;

/** A recorded finding with its deduplication id and capture timestamp. */
export interface PostCommentFinding extends PostCommentArgs {
  /** Stable identifier derived from the finding's file, line, and category. */
  findingId: string;
  /** Unix timestamp (ms) when the finding was recorded. */
  timestamp: number;
}

/**
 * Class to collect and manage review comments/findings.
 * Can be easily instantiated and mocked in unit tests.
 */
export class FindingsCollector {
  private findings: PostCommentFinding[] = [];
  private findingsById: Map<string, PostCommentFinding> = new Map();

  /** Records a finding and indexes it by its id for deduplication. */
  public addFinding(finding: PostCommentFinding): void {
    this.findings.push(finding);
    this.findingsById.set(finding.findingId, finding);
  }

  /** Looks up a previously recorded finding by its id, or undefined if absent. */
  public findExistingFinding(findingId: string): PostCommentFinding | undefined {
    return this.findingsById.get(findingId);
  }

  /** Returns all recorded findings in insertion order. */
  public getAllFindings(): PostCommentFinding[] {
    return this.findings;
  }

  /** Clears all recorded findings and their id index. */
  public reset(): void {
    this.findings = [];
    this.findingsById.clear();
  }
}

/**
 * Generates a stable finding id from the file, line, and category.
 *
 * @param args - The finding arguments to derive the id from.
 * @returns A base64-encoded deduplication key.
 */
export function generateFindingId(args: PostCommentArgs): string {
  const key = `${args.file}:${args.line}:${args.category}`;
  return Buffer.from(key).toString("base64");
}

const postCommentSchema = {
  type: "object",
  properties: {
    file: {
      type: "string",
      description: "Relative path to file in the repository",
    },
    line: {
      type: "number",
      description: "Line number in the file (1-indexed)",
    },
    body: {
      type: "string",
      description: "Review comment text, supporting markdown formatting",
    },
    severity: {
      type: "string",
      enum: ["critical", "high", "medium", "low"],
      description: "Finding severity level",
    },
    category: {
      type: "string",
      enum: ["bug", "security", "performance", "quality", "documentation"],
      description: "Finding category",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "Finding confidence rating",
    },
    suggestion: {
      type: "string",
      description: "Suggested code replacement or fix",
    },
    reasoning: {
      type: "string",
      description: "Internal analysis/justification citing code evidence and concrete impact",
    },
  },
  required: ["file", "line", "body", "severity", "category"],
};

/** Result of executing the postComment tool for a single finding. */
export interface ExecutePostCommentResult {
  /** Message returned to the model describing what happened. */
  message: string;
  /** Id of the recorded (or already-existing) finding. */
  findingId: string;
  /** Whether the finding was a duplicate of one already recorded. */
  isDuplicate: boolean;
}

/**
 * Core handler logic for executing the postComment tool.
 * Shared between Copilot SDK and OpenCode SDK tool adapters.
 */
export function executePostComment(
  args: PostCommentArgs,
  collector: FindingsCollector,
  output: OutputWriter = consoleOutputWriter
): ExecutePostCommentResult {
  const findingId = generateFindingId(args);
  const existing = collector.findExistingFinding(findingId);
  if (existing) {
    return {
      message: `Finding already recorded: ${existing.findingId}`,
      findingId: existing.findingId,
      isDuplicate: true,
    };
  }

  const finding: PostCommentFinding = {
    ...args,
    findingId,
    timestamp: Date.now(),
  };
  collector.addFinding(finding);

  output.log(
    `[Experimental Tool] Finding recorded: ${args.file}:${args.line} [${args.severity.toUpperCase()}] (${args.category}): ${args.body}`
  );

  return {
    message: `Finding recorded: ${findingId}`,
    findingId,
    isDuplicate: false,
  };
}

/**
 * Dynamically creates a postComment tool bound to a specific FindingsCollector instance.
 */
export function createPostCommentTool(
  collector: FindingsCollector,
  options?: { output?: OutputWriter }
) {
  const output = options?.output ?? consoleOutputWriter;
  return defineTool<PostCommentArgs>("postComment", {
    description:
      "Record a review comment to post on the PR. You MUST call this tool for every individual issue, bug, performance bottleneck, security concern, or quality finding you discover during the review. Do not bundle multiple issues into a single call.",
    skipPermission: true,
    parameters: postCommentSchema,
    handler: async (
      args: PostCommentArgs,
      _invocation: ToolInvocation
    ): Promise<ToolResultObject> => {
      const result = executePostComment(args, collector, output);
      return {
        textResultForLlm: result.message,
        resultType: "success",
      };
    },
  });
}

/**
 * Groups recorded findings by file, converting each into a FileFinding for the
 * batched file-results response shape.
 *
 * @param findings - Recorded findings to group.
 * @returns Map of filename to its converted findings array.
 */
function groupFindingsByFile(
  findings: PostCommentFinding[]
): Record<string, { findings: FileFinding[] }> {
  const fileResults: Record<string, { findings: FileFinding[] }> = {};
  for (const f of findings) {
    if (!fileResults[f.file]) {
      fileResults[f.file] = { findings: [] };
    }
    fileResults[f.file].findings.push({
      line: f.line,
      severity: f.severity,
      confidence: f.confidence ?? "high",
      category: f.category,
      message: f.body,
      suggestion: f.suggestion ?? "",
      reasoning: f.reasoning ?? "Recorded via tool call.",
      isPreExisting: false,
    });
  }
  return fileResults;
}

/**
 * Converts tool-collected findings into a fully-shaped parsed response that
 * matches the schemas of file, fast, cross-file, and batched review responses.
 *
 * @param findings - Findings recorded via the postComment tool.
 * @returns An object shaped like a parsed review response populated with the findings.
 */
export function convertFindingsToParsedResponse(findings: PostCommentFinding[]): unknown {
  return {
    findings: findings.map((f) => ({
      line: f.line,
      severity: f.severity,
      confidence: f.confidence ?? "high",
      category: f.category,
      message: f.body,
      suggestion: f.suggestion ?? "",
      reasoning: f.reasoning ?? "Recorded via tool call.",
      isPreExisting: false,
    })),
    file_results: groupFindingsByFile(findings),
    summary: `Review completed. Collected ${findings.length} findings via tool calls.`,
    overall_assessment: `Review completed. Collected ${findings.length} findings via tool calls.`,
    recommendations: [],
  };
}

/**
 * Merges tool-collected findings into an existing parsed JSON response,
 * appending them to whichever result shape the response uses (batched, fast,
 * cross-file, or flat findings).
 *
 * @param parsed - The parsed JSON response to merge into.
 * @param toolFindings - Findings recorded via the postComment tool.
 * @returns The merged response object; tool findings alone when the parsed value is unusable.
 */
export function combineToolAndJsonFindings(
  parsed: unknown,
  toolFindings: PostCommentFinding[]
): unknown {
  if (!parsed || typeof parsed !== "object") {
    return convertFindingsToParsedResponse(toolFindings);
  }

  const parsedObj = parsed as Record<string, unknown>;

  if ("file_results" in parsedObj) {
    const fileResults = { ...(parsedObj.file_results as Record<string, unknown>) };
    for (const f of toolFindings) {
      if (!fileResults[f.file]) {
        fileResults[f.file] = { findings: [] };
      }
      const fileData = { ...(fileResults[f.file] as Record<string, unknown>) };
      const findings = Array.isArray(fileData.findings) ? [...fileData.findings] : [];
      findings.push({
        line: f.line,
        severity: f.severity,
        confidence: f.confidence ?? "high",
        category: f.category,
        message: f.body,
        suggestion: f.suggestion ?? "",
        reasoning: f.reasoning ?? "Recorded via tool call.",
        isPreExisting: false,
      });
      fileResults[f.file] = { ...fileData, findings };
    }
    return { ...parsedObj, file_results: fileResults };
  }

  if ("summary" in parsedObj) {
    const findings = Array.isArray(parsedObj.findings) ? [...parsedObj.findings] : [];
    for (const f of toolFindings) {
      findings.push({
        file: f.file,
        line: f.line,
        severity: f.severity,
        confidence: f.confidence ?? "high",
        category: f.category,
        message: f.body,
        suggestion: f.suggestion ?? "",
        reasoning: f.reasoning ?? "Recorded via tool call.",
        isPreExisting: false,
      });
    }
    return { ...parsedObj, findings };
  }

  if ("overall_assessment" in parsedObj) {
    const findings = Array.isArray(parsedObj.findings) ? [...parsedObj.findings] : [];
    for (const f of toolFindings) {
      findings.push({
        severity: f.severity,
        confidence: f.confidence ?? "high",
        category: f.category,
        message: f.body,
        reasoning: f.reasoning ?? "Recorded via tool call.",
        affected_files: [f.file],
      });
    }
    return { ...parsedObj, findings };
  }

  if ("findings" in parsedObj) {
    const findings = Array.isArray(parsedObj.findings) ? [...parsedObj.findings] : [];
    for (const f of toolFindings) {
      findings.push({
        file: f.file,
        line: f.line,
        severity: f.severity,
        confidence: f.confidence ?? "high",
        category: f.category,
        message: f.body,
        suggestion: f.suggestion ?? "",
        reasoning: f.reasoning ?? "Recorded via tool call.",
        isPreExisting: false,
      });
    }
    return { ...parsedObj, findings };
  }

  return parsedObj;
}
