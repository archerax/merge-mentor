import { describe, expect, it } from "vitest";
import type { PRFile } from "../../platforms/types.js";
import { buildFilesSummary } from "./buildFilesSummary.js";

describe("buildFilesSummary", () => {
  it("formats single file correctly", () => {
    const files: readonly PRFile[] = [
      {
        filename: "src/index.ts",
        status: "modified",
        additions: 10,
        deletions: 5,
      },
    ];

    const result = buildFilesSummary(files);

    expect(result).toBe("- src/index.ts (modified, +10/-5)");
  });

  it("formats multiple files with line breaks", () => {
    const files: readonly PRFile[] = [
      {
        filename: "src/index.ts",
        status: "modified",
        additions: 10,
        deletions: 5,
      },
      {
        filename: "src/utils.ts",
        status: "added",
        additions: 25,
        deletions: 0,
      },
      {
        filename: "README.md",
        status: "modified",
        additions: 3,
        deletions: 2,
      },
    ];

    const result = buildFilesSummary(files);

    const expected = [
      "- src/index.ts (modified, +10/-5)",
      "- src/utils.ts (added, +25/-0)",
      "- README.md (modified, +3/-2)",
    ].join("\n");

    expect(result).toBe(expected);
  });

  it("handles empty file array", () => {
    const files: readonly PRFile[] = [];

    const result = buildFilesSummary(files);

    expect(result).toBe("");
  });

  it("handles file with zero additions and deletions", () => {
    const files: readonly PRFile[] = [
      {
        filename: "test.txt",
        status: "renamed",
        additions: 0,
        deletions: 0,
      },
    ];

    const result = buildFilesSummary(files);

    expect(result).toBe("- test.txt (renamed, +0/-0)");
  });

  it("handles files with large change counts", () => {
    const files: readonly PRFile[] = [
      {
        filename: "src/large-refactor.ts",
        status: "modified",
        additions: 999,
        deletions: 500,
      },
    ];

    const result = buildFilesSummary(files);

    expect(result).toBe("- src/large-refactor.ts (modified, +999/-500)");
  });

  it("preserves file paths with special characters", () => {
    const files: readonly PRFile[] = [
      {
        filename: "src/components/my-component.tsx",
        status: "added",
        additions: 50,
        deletions: 0,
      },
      {
        filename: "src/utils/data_helper.ts",
        status: "modified",
        additions: 15,
        deletions: 10,
      },
    ];

    const result = buildFilesSummary(files);

    const expected = [
      "- src/components/my-component.tsx (added, +50/-0)",
      "- src/utils/data_helper.ts (modified, +15/-10)",
    ].join("\n");

    expect(result).toBe(expected);
  });
});
