import { describe, expect, it, vi } from "vitest";
import type { FileReviewResult, PRFile } from "../platforms/types.js";
import { findNearestValidLine } from "../utils/diffParser.js";
import { LineNumberValidator } from "./lineNumberValidator.js";

vi.mock("../utils/diffParser.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/diffParser.js")>();
  return {
    ...actual,
    findNearestValidLine: vi.fn().mockImplementation(actual.findNearestValidLine),
  };
});

describe("LineNumberValidator", () => {
  const validator = new LineNumberValidator();

  it("filters out file results if file has no valid diff lines", () => {
    const fileResults: FileReviewResult[] = [
      {
        filename: "test.ts",
        findings: [
          {
            line: 10,
            severity: "high",
            confidence: "high",
            category: "bug",
            message: "Test bug",
            suggestion: "Fix",
            reasoning: "Test reasoning",
          },
        ],
      },
    ];

    const files: PRFile[] = [
      {
        filename: "test.ts",
        status: "modified",
        additions: 0,
        deletions: 0,
        patch: "", // empty patch has no valid diff lines
      },
    ];

    const result = validator.validate(fileResults, files);
    expect(result).toEqual([]);
  });

  it("keeps findings with valid line numbers", () => {
    const fileResults: FileReviewResult[] = [
      {
        filename: "test.ts",
        findings: [
          {
            line: 2,
            severity: "high",
            confidence: "high",
            category: "bug",
            message: "Test bug",
            suggestion: "Fix",
            reasoning: "Test reasoning",
          },
        ],
      },
    ];

    const files: PRFile[] = [
      {
        filename: "test.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "@@ -1,2 +1,3 @@\n line1\n+added line 2\n line 3",
      },
    ];

    const result = validator.validate(fileResults, files);
    expect(result).toHaveLength(1);
    expect(result[0].findings).toHaveLength(1);
    expect(result[0].findings[0].line).toBe(2);
  });

  it("adjusts findings to nearest valid line number if exact is invalid", () => {
    const fileResults: FileReviewResult[] = [
      {
        filename: "test.ts",
        findings: [
          {
            line: 10, // Invalid line, not in diff
            severity: "high",
            confidence: "high",
            category: "bug",
            message: "Test bug",
            suggestion: "Fix",
            reasoning: "Test reasoning",
          },
        ],
      },
    ];

    const files: PRFile[] = [
      {
        filename: "test.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "@@ -1,2 +1,3 @@\n line1\n+added line 2\n line 3",
      },
    ];

    const result = validator.validate(fileResults, files);
    expect(result).toHaveLength(1);
    expect(result[0].findings).toHaveLength(1);
    // Nearest valid diff line in patch (new lines 1, 2, 3) is 3 (nearest to 10)
    expect(result[0].findings[0].line).toBe(3);
  });

  it("filters out finding and logs warning if no valid line is found", () => {
    vi.mocked(findNearestValidLine).mockReturnValueOnce(undefined);

    const fileResults: FileReviewResult[] = [
      {
        filename: "test.ts",
        findings: [
          {
            line: 10,
            severity: "high",
            confidence: "high",
            category: "bug",
            message: "Test bug",
            suggestion: "Fix",
            reasoning: "Test reasoning",
          },
        ],
      },
    ];

    const files: PRFile[] = [
      {
        filename: "test.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "@@ -1,2 +1,3 @@\n line1\n+added line 2\n line 3",
      },
    ];

    const result = validator.validate(fileResults, files);
    expect(result).toEqual([]);
  });
});
