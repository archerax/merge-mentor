import { describe, expect, it } from "vitest";
import type { FileFinding } from "../platforms/types.js";
import { formatNativeSuggestion, validateNativeSuggestion } from "./nativeSuggestion.js";

function finding(overrides: Partial<FileFinding> = {}): FileFinding {
  return {
    line: 11,
    severity: "high",
    confidence: "high",
    category: "bug",
    message: "Handle the missing value",
    suggestion: "Add a guard",
    reasoning: "The value can be absent.",
    replacement: "if (!value) return;",
    ...overrides,
  };
}

const patch = `@@ -9,4 +9,5 @@
 const before = true;
 const value = getValue();
 return value;
 const after = true;`;

describe("native suggestions", () => {
  it("accepts a high-confidence single-line replacement", () => {
    expect(validateNativeSuggestion(finding(), patch)).toEqual({
      startLine: 11,
      endLine: 11,
      replacement: "if (!value) return;",
    });
  });

  it("accepts a multiline replacement shorter than ten lines", () => {
    const result = validateNativeSuggestion(
      finding({
        startLine: 10,
        endLine: 11,
        replacement: "const value = getValue();\nif (!value) return;",
      }),
      patch
    );

    expect(result?.startLine).toBe(10);
    expect(result?.endLine).toBe(11);
  });

  it("rejects low-confidence findings", () => {
    expect(validateNativeSuggestion(finding({ confidence: "medium" }), patch)).toBeUndefined();
  });

  it("rejects ten-line target and replacement ranges", () => {
    const tenLinePatch = `@@ -1,10 +1,10 @@\n${Array.from(
      { length: 10 },
      (_, index) => `+line ${index + 1}`
    ).join("\n")}`;

    expect(
      validateNativeSuggestion(
        finding({
          line: 1,
          startLine: 1,
          endLine: 10,
          replacement: `${"line\n".repeat(9)}line`,
        }),
        tenLinePatch
      )
    ).toBeUndefined();
  });

  it("rejects targets outside the patch and deleted lines", () => {
    expect(validateNativeSuggestion(finding({ line: 99 }), patch)).toBeUndefined();
    expect(
      validateNativeSuggestion(finding({ line: 10 }), "@@ -10,1 +10,0 @@\n-old")
    ).toBeUndefined();
  });

  it("rejects imports unless the target range includes an import", () => {
    expect(
      validateNativeSuggestion(finding({ replacement: "import x from 'x';" }), patch)
    ).toBeUndefined();
  });

  it("formats a native suggestion block", () => {
    expect(
      formatNativeSuggestion({ startLine: 11, endLine: 11, replacement: "return value;" })
    ).toBe("\n\n```suggestion\nreturn value;\n```");
  });
});
