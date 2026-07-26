import { describe, expect, it } from "vitest";
import { createCapturingOutputWriter } from "../../ports/outputWriter.test-helper.js";
import { createOpencodePostCommentTool } from "./opencodeAdapter.js";
import { FindingsCollector } from "./postCommentTool.js";

describe("opencodeAdapter", () => {
  describe("createOpencodePostCommentTool", () => {
    it("creates a tool definition with valid metadata and parameters schema", () => {
      const collector = new FindingsCollector();
      const tool = createOpencodePostCommentTool(collector);

      expect(tool.name).toBe("postComment");
      expect(tool.description).toContain("Record a review comment");
      expect(tool.parameters.type).toBe("object");
      expect(tool.parameters.required).toEqual(["file", "line", "body", "severity", "category"]);
    });

    it("executes handler successfully with valid arguments and records finding in collector", async () => {
      const collector = new FindingsCollector();
      const output = createCapturingOutputWriter();
      const tool = createOpencodePostCommentTool(collector, { output });

      const args = {
        file: "src/utils/test.ts",
        line: 15,
        body: "Refactor this function to improve clarity.",
        severity: "medium",
        category: "quality",
        confidence: "high",
        reasoning: "Improves readability and maintainability.",
      };

      const result = await tool.handler(args);

      expect(result.resultType).toBe("success");
      expect(result.textResultForLlm).toContain("Finding recorded");
      expect(collector.getAllFindings()).toHaveLength(1);
      expect(collector.getAllFindings()[0]).toMatchObject({
        file: "src/utils/test.ts",
        line: 15,
        body: "Refactor this function to improve clarity.",
        severity: "medium",
        category: "quality",
      });
      expect(output.output.some((entry) => entry.data.includes("Finding recorded"))).toBe(true);
    });

    it("throws error in handler when invalid arguments are provided", async () => {
      const collector = new FindingsCollector();
      const tool = createOpencodePostCommentTool(collector);

      const invalidArgs = {
        file: "src/utils/test.ts",
        line: -5, // invalid negative line
        body: "",
        severity: "unknown-severity",
        category: "quality",
      };

      await expect(tool.handler(invalidArgs)).rejects.toThrow();
      expect(collector.getAllFindings()).toHaveLength(0);
    });
  });
});
