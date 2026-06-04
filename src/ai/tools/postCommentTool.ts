import type { ToolInvocation, ToolResultObject } from "@github/copilot-sdk";
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { consoleOutputWriter, type OutputWriter } from "../../ports/index.js";

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

export type PostCommentArgs = z.infer<typeof PostCommentArgsSchema>;

export interface PostCommentFinding extends PostCommentArgs {
  findingId: string;
  timestamp: number;
}

/**
 * Class to collect and manage review comments/findings.
 * Can be easily instantiated and mocked in unit tests.
 */
export class FindingsCollector {
  private findings: PostCommentFinding[] = [];
  private findingsById: Map<string, PostCommentFinding> = new Map();

  public addFinding(finding: PostCommentFinding): void {
    this.findings.push(finding);
    this.findingsById.set(finding.findingId, finding);
  }

  public findExistingFinding(findingId: string): PostCommentFinding | undefined {
    return this.findingsById.get(findingId);
  }

  public getAllFindings(): PostCommentFinding[] {
    return this.findings;
  }

  public reset(): void {
    this.findings = [];
    this.findingsById.clear();
  }
}

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
      // Check for duplicate
      const findingId = generateFindingId(args);
      const existing = collector.findExistingFinding(findingId);
      if (existing) {
        return {
          textResultForLlm: `Finding already recorded: ${existing.findingId}`,
          resultType: "success",
        };
      }

      // Add to findings collection
      const finding: PostCommentFinding = {
        ...args,
        findingId,
        timestamp: Date.now(),
      };
      collector.addFinding(finding);

      // Print the finding details to the console/output writer for visibility in experimental mode
      output.log(
        `[Experimental Tool] Finding recorded: ${args.file}:${args.line} [${args.severity.toUpperCase()}] (${args.category}): ${args.body}`
      );

      return {
        textResultForLlm: `Finding recorded: ${findingId}`,
        resultType: "success",
      };
    },
  });
}
