import { consoleOutputWriter, type OutputWriter } from "../../ports/index.js";
import type { FindingsCollector } from "./postCommentTool.js";
import { executePostComment, PostCommentArgsSchema } from "./postCommentTool.js";

/**
 * Interface representing a provider-agnostic custom tool definition compatible with OpenCode.
 */
export interface OpencodeToolDefinition {
  /** Name of the tool exposed to the model. */
  name: string;
  /** Description telling the model when and how to invoke the tool. */
  description: string;
  /** JSON schema describing the tool's accepted parameters. */
  parameters: Record<string, unknown>;
  /** Async function executing the tool and returning its result text for the LLM. */
  handler: (
    args: Record<string, unknown>
  ) => Promise<{ textResultForLlm: string; resultType: string }>;
}

/**
 * Creates an OpenCode-compatible postComment tool definition bound to a FindingsCollector instance.
 */
export function createOpencodePostCommentTool(
  collector: FindingsCollector,
  options?: { output?: OutputWriter }
): OpencodeToolDefinition {
  const output = options?.output ?? consoleOutputWriter;
  return {
    name: "postComment",
    description:
      "Record a review comment to post on the PR. You MUST call this tool for every individual issue, bug, performance bottleneck, security concern, or quality finding you discover during the review. Do not bundle multiple issues into a single call.",
    parameters: {
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
    },
    handler: async (rawArgs: Record<string, unknown>) => {
      const parsedArgs = PostCommentArgsSchema.parse(rawArgs);
      const result = executePostComment(parsedArgs, collector, output);
      return {
        textResultForLlm: result.message,
        resultType: "success",
      };
    },
  };
}
