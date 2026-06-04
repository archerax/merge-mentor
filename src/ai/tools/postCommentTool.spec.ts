import type { ToolInvocation, ToolResultObject } from "@github/copilot-sdk";
import { describe, expect, it } from "vitest";
import { createCapturingOutputWriter } from "../../ports/outputWriter.test-helper.js";
import {
  createPostCommentTool,
  FindingsCollector,
  generateFindingId,
  PostCommentArgsSchema,
  type PostCommentFinding,
} from "./postCommentTool.js";

describe("postCommentTool", () => {
  describe("schema validation", () => {
    it("should validate correct arguments", () => {
      const validArgs = {
        file: "src/index.ts",
        line: 42,
        body: "Check this line.",
        severity: "high",
        category: "bug",
        confidence: "medium",
        suggestion: "const x = 1;",
        reasoning: "Reasoning for the bug.",
      };

      const result = PostCommentArgsSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.file).toBe("src/index.ts");
        expect(result.data.line).toBe(42);
        expect(result.data.severity).toBe("high");
        expect(result.data.category).toBe("bug");
      }
    });

    it("should accept minimum required arguments", () => {
      const minArgs = {
        file: "src/index.ts",
        line: 10,
        body: "Simple body",
        severity: "low",
        category: "documentation",
      };

      const result = PostCommentArgsSchema.safeParse(minArgs);
      expect(result.success).toBe(true);
    });

    it("should reject negative line numbers", () => {
      const invalidArgs = {
        file: "src/index.ts",
        line: -1,
        body: "Invalid line number",
        severity: "low",
        category: "documentation",
      };

      const result = PostCommentArgsSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });

    it("should reject invalid severity enum value", () => {
      const invalidArgs = {
        file: "src/index.ts",
        line: 5,
        body: "Invalid severity",
        severity: "super-critical",
        category: "bug",
      };

      const result = PostCommentArgsSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });

    it("should reject invalid category enum value", () => {
      const invalidArgs = {
        file: "src/index.ts",
        line: 5,
        body: "Invalid category",
        severity: "medium",
        category: "unknown-category",
      };

      const result = PostCommentArgsSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });
  });

  describe("FindingsCollector", () => {
    it("should support adding and retrieving findings", () => {
      const collector = new FindingsCollector();
      const finding: PostCommentFinding = {
        file: "src/main.ts",
        line: 12,
        body: "Test body",
        severity: "medium",
        category: "performance",
        findingId: "test-finding-id",
        timestamp: Date.now(),
      };

      collector.addFinding(finding);
      expect(collector.getAllFindings()).toHaveLength(1);
      expect(collector.findExistingFinding("test-finding-id")).toEqual(finding);
    });

    it("should support resetting findings", () => {
      const collector = new FindingsCollector();
      const finding: PostCommentFinding = {
        file: "src/main.ts",
        line: 12,
        body: "Test body",
        severity: "medium",
        category: "performance",
        findingId: "test-finding-id",
        timestamp: Date.now(),
      };

      collector.addFinding(finding);
      expect(collector.getAllFindings()).toHaveLength(1);
      collector.reset();
      expect(collector.getAllFindings()).toHaveLength(0);
      expect(collector.findExistingFinding("test-finding-id")).toBeUndefined();
    });

    it("should generate consistent finding IDs", () => {
      const args1 = {
        file: "src/main.ts",
        line: 12,
        body: "Test body",
        severity: "medium" as const,
        category: "performance" as const,
      };

      const args2 = {
        file: "src/main.ts",
        line: 12,
        body: "Another body",
        severity: "high" as const,
        category: "performance" as const,
      };

      const id1 = generateFindingId(args1);
      const id2 = generateFindingId(args2);
      expect(id1).toBe(id2); // Must match because it's based on file:line:category
    });
  });

  describe("tool handler", () => {
    const mockInvocation = {
      sessionId: "session-123",
      toolCallId: "call-456",
      toolName: "postComment",
    } as ToolInvocation;

    it("should record valid findings and return success", async () => {
      const collector = new FindingsCollector();
      const postCommentTool = createPostCommentTool(collector);
      const args = {
        file: "src/db.ts",
        line: 88,
        body: "Optimize index here.",
        severity: "high" as const,
        category: "performance" as const,
        confidence: "high" as const,
      };

      const result = (await postCommentTool.handler(args, mockInvocation)) as ToolResultObject;

      expect(result.resultType).toBe("success");
      expect(result.textResultForLlm).toContain("Finding recorded:");
      expect(collector.getAllFindings()).toHaveLength(1);
      expect(collector.getAllFindings()[0].file).toBe("src/db.ts");
      expect(collector.getAllFindings()[0].line).toBe(88);
    });

    it("should handle duplicate tool calls as success but return already recorded ID", async () => {
      const collector = new FindingsCollector();
      const postCommentTool = createPostCommentTool(collector);
      const args = {
        file: "src/db.ts",
        line: 88,
        body: "Optimize index here.",
        severity: "high" as const,
        category: "performance" as const,
        confidence: "high" as const,
      };

      // Call first time
      await postCommentTool.handler(args, mockInvocation);
      const firstId = collector.getAllFindings()[0].findingId;

      // Call second time
      const result2 = (await postCommentTool.handler(args, mockInvocation)) as ToolResultObject;

      expect(result2.resultType).toBe("success");
      expect(result2.textResultForLlm).toBe(`Finding already recorded: ${firstId}`);
      expect(collector.getAllFindings()).toHaveLength(1); // Only one recorded
    });

    it("should write finding to the output writer on successful record", async () => {
      const collector = new FindingsCollector();
      const output = createCapturingOutputWriter();
      const postCommentTool = createPostCommentTool(collector, { output });
      const args = {
        file: "src/db.ts",
        line: 88,
        body: "Optimize index here.",
        severity: "high" as const,
        category: "performance" as const,
      };

      await postCommentTool.handler(args, mockInvocation);

      expect(output.output).toHaveLength(1);
      expect(output.output[0].type).toBe("log");
      expect(output.output[0].data).toContain(
        "[Experimental Tool] Finding recorded: src/db.ts:88 [HIGH] (performance): Optimize index here."
      );
    });
  });
});
