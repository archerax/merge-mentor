/**
 * Integration tests for the Copilot client parsing functionality.
 * Tests response parsing and validation behavior.
 * 
 * Note: Tests for executePrompt that require spawn mocking are in
 * the unit tests (src/copilot/client.spec.ts). This file focuses on
 * integration-level parsing and response handling.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotClient } from "../../src/copilot/client.js";

describe("CopilotClient Response Parsing Integration", () => {
  let client: CopilotClient;

  beforeEach(() => {
    client = new CopilotClient({ maxRetries: 1 });
  });

  describe("parseFileReview", () => {
    it("parses valid file review response with multiple findings", () => {
      const response = {
        raw: "{}",
        parsed: {
          findings: [
            {
              line: 10,
              severity: "high",
              category: "security",
              message: "SQL injection risk",
              suggestion: "Use prepared statements",
            },
            {
              line: 25,
              severity: "medium",
              category: "quality",
              message: "Magic number",
              suggestion: "Extract to constant",
            },
            {
              line: 42,
              severity: "low",
              category: "documentation",
              message: "Missing JSDoc",
              suggestion: "Add documentation",
            },
          ],
        },
      };

      const result = client.parseFileReview("src/app.ts", response);

      expect(result.filename).toBe("src/app.ts");
      expect(result.findings).toHaveLength(3);
      expect(result.findings[0].severity).toBe("high");
      expect(result.findings[0].category).toBe("security");
      expect(result.findings[1].severity).toBe("medium");
      expect(result.findings[2].severity).toBe("low");
    });

    it("handles all valid severity levels", () => {
      const severities = ["critical", "high", "medium", "low"] as const;

      for (const severity of severities) {
        const response = {
          raw: "{}",
          parsed: {
            findings: [
              {
                line: 1,
                severity,
                category: "quality",
                message: "Test",
                suggestion: "Fix",
              },
            ],
          },
        };

        const result = client.parseFileReview("test.ts", response);
        expect(result.findings[0].severity).toBe(severity);
      }
    });

    it("handles all valid category values", () => {
      const categories = ["bug", "security", "performance", "quality", "documentation"] as const;

      for (const category of categories) {
        const response = {
          raw: "{}",
          parsed: {
            findings: [
              {
                line: 1,
                severity: "medium",
                category,
                message: "Test",
                suggestion: "Fix",
              },
            ],
          },
        };

        const result = client.parseFileReview("test.ts", response);
        expect(result.findings[0].category).toBe(category);
      }
    });

    it("defaults invalid severity to medium", () => {
      const response = {
        raw: "{}",
        parsed: {
          findings: [
            {
              line: 10,
              severity: "invalid-severity",
              category: "security",
              message: "Issue",
              suggestion: "Fix",
            },
          ],
        },
      };

      const result = client.parseFileReview("src/app.ts", response);
      expect(result.findings[0].severity).toBe("medium");
    });

    it("defaults invalid category to quality", () => {
      const response = {
        raw: "{}",
        parsed: {
          findings: [
            {
              line: 10,
              severity: "high",
              category: "invalid-category",
              message: "Issue",
              suggestion: "Fix",
            },
          ],
        },
      };

      const result = client.parseFileReview("src/app.ts", response);
      expect(result.findings[0].category).toBe("quality");
    });

    it("handles missing findings array", () => {
      const response = {
        raw: "{}",
        parsed: {},
      };

      const result = client.parseFileReview("src/app.ts", response);
      expect(result.findings).toHaveLength(0);
    });

    it("handles null findings", () => {
      const response = {
        raw: "{}",
        parsed: {
          findings: null,
        },
      };

      const result = client.parseFileReview("src/app.ts", response);
      expect(result.findings).toHaveLength(0);
    });

    it("handles empty findings array", () => {
      const response = {
        raw: "{}",
        parsed: {
          findings: [],
        },
      };

      const result = client.parseFileReview("src/app.ts", response);
      expect(result.findings).toHaveLength(0);
    });

    it("converts non-numeric line to 0", () => {
      const response = {
        raw: "{}",
        parsed: {
          findings: [
            {
              line: "not-a-number",
              severity: "high",
              category: "security",
              message: "Issue",
              suggestion: "Fix",
            },
          ],
        },
      };

      const result = client.parseFileReview("src/app.ts", response);
      expect(result.findings[0].line).toBe(0);
    });

    it("converts missing message/suggestion to empty string", () => {
      const response = {
        raw: "{}",
        parsed: {
          findings: [
            {
              line: 10,
              severity: "high",
              category: "security",
            },
          ],
        },
      };

      const result = client.parseFileReview("src/app.ts", response);
      expect(result.findings[0].message).toBe("");
      expect(result.findings[0].suggestion).toBe("");
    });
  });

  describe("parseCrossFileReview", () => {
    it("parses valid cross-file review response", () => {
      const response = {
        raw: "{}",
        parsed: {
          overall_assessment: "Code quality is good overall with minor issues",
          findings: [
            {
              severity: "high",
              category: "architecture",
              message: "Circular dependency detected",
              affected_files: ["src/a.ts", "src/b.ts"],
            },
            {
              severity: "medium",
              category: "design",
              message: "Inconsistent naming conventions",
              affected_files: ["src/utils.ts", "src/helpers.ts", "src/common.ts"],
            },
          ],
          recommendations: [
            "Add unit tests for edge cases",
            "Improve error handling",
            "Consider extracting common utilities",
          ],
        },
      };

      const result = client.parseCrossFileReview(response);

      expect(result.overallAssessment).toBe("Code quality is good overall with minor issues");
      expect(result.findings).toHaveLength(2);
      expect(result.findings[0].severity).toBe("high");
      expect(result.findings[0].category).toBe("architecture");
      expect(result.findings[0].affectedFiles).toEqual(["src/a.ts", "src/b.ts"]);
      expect(result.findings[1].affectedFiles).toHaveLength(3);
      expect(result.recommendations).toHaveLength(3);
    });

    it("handles all valid cross-file categories", () => {
      const categories = [
        "architecture",
        "design",
        "testing",
        "documentation",
        "bug",
        "security",
        "performance",
        "quality",
      ] as const;

      for (const category of categories) {
        const response = {
          raw: "{}",
          parsed: {
            findings: [
              {
                severity: "medium",
                category,
                message: "Test finding",
                affected_files: ["file.ts"],
              },
            ],
          },
        };

        const result = client.parseCrossFileReview(response);
        expect(result.findings[0].category).toBe(category);
      }
    });

    it("defaults missing overall_assessment", () => {
      const response = {
        raw: "{}",
        parsed: {
          findings: [],
          recommendations: [],
        },
      };

      const result = client.parseCrossFileReview(response);
      expect(result.overallAssessment).toBe("Review completed");
    });

    it("handles missing fields with defaults", () => {
      const response = {
        raw: "{}",
        parsed: {},
      };

      const result = client.parseCrossFileReview(response);

      expect(result.overallAssessment).toBe("Review completed");
      expect(result.findings).toHaveLength(0);
      expect(result.recommendations).toHaveLength(0);
    });

    it("handles null findings and recommendations", () => {
      const response = {
        raw: "{}",
        parsed: {
          overall_assessment: "OK",
          findings: null,
          recommendations: null,
        },
      };

      const result = client.parseCrossFileReview(response);
      expect(result.findings).toHaveLength(0);
      expect(result.recommendations).toHaveLength(0);
    });

    it("converts non-array affected_files to empty array", () => {
      const response = {
        raw: "{}",
        parsed: {
          findings: [
            {
              severity: "medium",
              category: "design",
              message: "Issue",
              affected_files: "not-an-array",
            },
          ],
        },
      };

      const result = client.parseCrossFileReview(response);
      expect(result.findings[0].affectedFiles).toEqual([]);
    });

    it("defaults invalid cross-file category to design", () => {
      const response = {
        raw: "{}",
        parsed: {
          findings: [
            {
              severity: "medium",
              category: "invalid-category",
              message: "Issue",
              affected_files: ["file.ts"],
            },
          ],
        },
      };

      const result = client.parseCrossFileReview(response);
      expect(result.findings[0].category).toBe("design");
    });
  });
});

describe("CopilotClient Input Validation", () => {
  let client: CopilotClient;

  beforeEach(() => {
    client = new CopilotClient({ maxRetries: 1 });
  });

  it("rejects empty prompt", async () => {
    await expect(client.executePrompt("")).rejects.toThrow("Prompt cannot be empty");
  });

  it("rejects whitespace-only prompt", async () => {
    await expect(client.executePrompt("   ")).rejects.toThrow("Prompt cannot be empty");
    await expect(client.executePrompt("\n\t")).rejects.toThrow("Prompt cannot be empty");
  });
});

describe("CopilotClient Configuration", () => {
  it("accepts default options", () => {
    const client = new CopilotClient();
    expect(client).toBeDefined();
  });

  it("accepts custom options", () => {
    const client = new CopilotClient({
      maxRetries: 5,
      timeoutMs: 60000,
      model: "gpt-4-turbo",
    });
    expect(client).toBeDefined();
  });

  it("accepts partial options", () => {
    const client = new CopilotClient({ maxRetries: 2 });
    expect(client).toBeDefined();
  });
});
