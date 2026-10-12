import type { ToolInvocation, ToolResultObject } from "@github/copilot-sdk";
import { createCapturingOutputWriter } from "@merge-mentor/shared/ports/outputWriter.test-helper.js";
import { describe, expect, it } from "vitest";

import {
  combineToolAndJsonFindings,
  convertFindingsToParsedResponse,
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
      expect(result).toMatchObject({
        success: true,
        data: {
          file: "src/index.ts",
          line: 42,
          severity: "high",
          category: "bug",
        },
      });
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

      const result = (await postCommentTool.handler?.(args, mockInvocation)) as ToolResultObject;

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
      await postCommentTool.handler?.(args, mockInvocation);
      const firstId = collector.getAllFindings()[0].findingId;

      // Call second time
      const result2 = (await postCommentTool.handler?.(args, mockInvocation)) as ToolResultObject;

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

      await postCommentTool.handler?.(args, mockInvocation);

      expect(output.output).toHaveLength(1);
      expect(output.output[0].type).toBe("log");
      expect(output.output[0].data).toContain(
        "[Experimental Tool] Finding recorded: src/db.ts:88 [HIGH] (performance): Optimize index here."
      );
    });
  });

  describe("convertFindingsToParsedResponse", () => {
    const findings: PostCommentFinding[] = [
      {
        file: "src/a.ts",
        line: 1,
        body: "first",
        severity: "high",
        category: "bug",
        findingId: "id-a",
        timestamp: 0,
      },
      {
        file: "src/b.ts",
        line: 2,
        body: "second",
        severity: "low",
        category: "quality",
        findingId: "id-b",
        timestamp: 0,
        confidence: "low",
        suggestion: "use const",
        reasoning: "immutability",
      },
    ];

    it("returns an empty shape for no findings", () => {
      const parsed = convertFindingsToParsedResponse([]) as {
        findings: unknown[];
        file_results: Record<string, unknown>;
        summary: string;
      };

      expect(parsed.findings).toEqual([]);
      expect(parsed.file_results).toEqual({});
      expect(parsed.summary).toContain("0 findings");
    });

    it("groups findings by file and applies defaults", () => {
      const parsed = convertFindingsToParsedResponse(findings) as {
        findings: Record<string, unknown>[];
        file_results: Record<string, { findings: Record<string, unknown>[] }>;
      };

      expect(parsed.findings).toHaveLength(2);
      expect(parsed.findings[0]).toMatchObject({
        line: 1,
        confidence: "high",
        suggestion: "",
        reasoning: "Recorded via tool call.",
        isPreExisting: false,
      });
      expect(parsed.findings[1]).toMatchObject({
        suggestion: "use const",
        reasoning: "immutability",
      });
      expect(Object.keys(parsed.file_results).toSorted()).toEqual(["src/a.ts", "src/b.ts"]);
      expect(parsed.file_results["src/a.ts"].findings).toHaveLength(1);
    });
  });

  describe("combineToolAndJsonFindings", () => {
    const toolFindings: PostCommentFinding[] = [
      {
        file: "src/a.ts",
        line: 1,
        body: "tool finding",
        severity: "high",
        category: "bug",
        findingId: "id-a",
        timestamp: 0,
      },
      {
        file: "src/b.ts",
        line: 2,
        body: "another tool finding",
        severity: "medium",
        category: "security",
        findingId: "id-b",
        timestamp: 0,
      },
    ];

    it("falls back to the tool-only shape when parsed is not an object", () => {
      expect(combineToolAndJsonFindings(null, toolFindings)).toEqual(
        convertFindingsToParsedResponse(toolFindings)
      );
      expect(combineToolAndJsonFindings("nope", toolFindings)).toEqual(
        convertFindingsToParsedResponse(toolFindings)
      );
    });

    it("appends into existing and new file_results entries", () => {
      const parsed = {
        file_results: { "src/a.ts": { findings: [{ line: 9, message: "existing" }] } },
        summary: "keep me",
      };

      const merged = combineToolAndJsonFindings(parsed, toolFindings) as {
        file_results: Record<string, { findings: Record<string, unknown>[] }>;
        summary: string;
      };

      expect(merged.summary).toBe("keep me");
      expect(merged.file_results["src/a.ts"].findings).toHaveLength(2);
      expect(merged.file_results["src/b.ts"].findings).toHaveLength(1);
    });

    it("tolerates a non-array findings field in file_results", () => {
      const parsed = { file_results: { "src/a.ts": { findings: "not-an-array" } } };

      const merged = combineToolAndJsonFindings(parsed, [toolFindings[0]]) as {
        file_results: Record<string, { findings: Record<string, unknown>[] }>;
      };

      expect(merged.file_results["src/a.ts"].findings).toHaveLength(1);
      expect(merged.file_results["src/a.ts"].findings[0]).toMatchObject({
        message: "tool finding",
      });
    });

    it("appends into a summary-shaped response", () => {
      const parsed = { summary: "old summary", findings: [{ line: 1, message: "existing" }] };

      const merged = combineToolAndJsonFindings(parsed, toolFindings) as {
        summary: string;
        findings: Record<string, unknown>[];
      };

      expect(merged.findings).toHaveLength(3);
      expect(merged.findings[2]).toMatchObject({
        file: "src/b.ts",
        message: "another tool finding",
      });
    });

    it("starts a fresh findings array for a summary response without one", () => {
      const parsed = { summary: "old summary", findings: "bad" };

      const merged = combineToolAndJsonFindings(parsed, [toolFindings[0]]) as {
        findings: Record<string, unknown>[];
      };

      expect(merged.findings).toHaveLength(1);
    });

    it("appends into an overall_assessment response using affected_files", () => {
      const parsed = { overall_assessment: "assessment", findings: [] };

      const merged = combineToolAndJsonFindings(parsed, toolFindings) as {
        overall_assessment: string;
        findings: Record<string, unknown>[];
      };

      expect(merged.findings).toHaveLength(2);
      expect(merged.findings[0]).toMatchObject({
        affected_files: ["src/a.ts"],
        message: "tool finding",
      });
      expect(merged.findings[0]).not.toHaveProperty("file");
    });

    it("appends into a flat findings response", () => {
      const parsed = { findings: [] };

      const merged = combineToolAndJsonFindings(parsed, toolFindings) as {
        findings: Record<string, unknown>[];
      };

      expect(merged.findings).toHaveLength(2);
      expect(merged.findings[0]).toMatchObject({ file: "src/a.ts", line: 1 });
    });

    it("returns the parsed object unchanged when no shape is recognized", () => {
      const parsed = { unrelated: true };
      expect(combineToolAndJsonFindings(parsed, toolFindings)).toEqual(parsed);
    });
  });
});
