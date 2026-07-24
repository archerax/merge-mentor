import { describe, expect, it } from "vitest";
import { inferPromptType } from "./promptType.js";

describe("inferPromptType", () => {
  it("should detect batched-file-review from file_results", () => {
    expect(inferPromptType("Review file_results for multiple files")).toBe("batched-file-review");
  });

  it("should detect cross-file-review from cross-file", () => {
    expect(inferPromptType("Review cross-file changes")).toBe("cross-file-review");
  });

  it("should detect file-review from 'Review the following file'", () => {
    expect(inferPromptType("Review the following file: src/index.ts")).toBe("file-review");
  });

  it("should detect fast-review from 'fast' and 'review'", () => {
    expect(inferPromptType("Run a fast review of this PR")).toBe("fast-review");
  });

  it("should fall back to unknown for unrecognized prompts", () => {
    expect(inferPromptType("Generate a summary of changes")).toBe("unknown");
  });

  it("should not match fast without review", () => {
    expect(inferPromptType("This is fast but does not contain the word")).toBe("unknown");
  });
});
