import { describe, expect, it } from "vitest";
import { convertToNumberedDiff, formatNumberedDiff, parseAndNumberDiff } from "./diffFormatter.js";

describe("diffFormatter", () => {
  describe("parseAndNumberDiff", () => {
    it("returns empty hunks for undefined patch", () => {
      const result = parseAndNumberDiff(undefined);
      expect(result.hunks).toHaveLength(0);
    });

    it("returns empty hunks for empty patch", () => {
      const result = parseAndNumberDiff("");
      expect(result.hunks).toHaveLength(0);
    });

    it("parses added lines with correct line numbers", () => {
      const patch = `@@ -10,3 +10,4 @@ function test() {
 context line
+added line 1
+added line 2
 context line`;

      const result = parseAndNumberDiff(patch);

      expect(result.hunks).toHaveLength(1);
      expect(result.hunks[0].lines).toHaveLength(4);
      expect(result.hunks[0].lines[0]).toEqual({
        newLineNumber: 10,
        type: "context",
        content: "context line",
      });
      expect(result.hunks[0].lines[1]).toEqual({
        newLineNumber: 11,
        type: "added",
        content: "added line 1",
      });
      expect(result.hunks[0].lines[2]).toEqual({
        newLineNumber: 12,
        type: "added",
        content: "added line 2",
      });
      expect(result.hunks[0].lines[3]).toEqual({
        newLineNumber: 13,
        type: "context",
        content: "context line",
      });
    });

    it("parses deleted lines without line numbers", () => {
      const patch = `@@ -10,4 +10,2 @@ function test() {
 context line
-deleted line 1
-deleted line 2
 context line`;

      const result = parseAndNumberDiff(patch);

      expect(result.hunks[0].lines).toHaveLength(4);
      expect(result.hunks[0].lines[0]).toEqual({
        newLineNumber: 10,
        type: "context",
        content: "context line",
      });
      expect(result.hunks[0].lines[1]).toEqual({
        newLineNumber: undefined,
        type: "removed",
        content: "deleted line 1",
      });
      expect(result.hunks[0].lines[2]).toEqual({
        newLineNumber: undefined,
        type: "removed",
        content: "deleted line 2",
      });
      expect(result.hunks[0].lines[3]).toEqual({
        newLineNumber: 11,
        type: "context",
        content: "context line",
      });
    });

    it("handles multiple hunks", () => {
      const patch = `@@ -10,2 +10,3 @@ function test() {
 context
+added line
 context
@@ -20,2 +21,3 @@ function other() {
 context
+another added line
 context`;

      const result = parseAndNumberDiff(patch);

      expect(result.hunks).toHaveLength(2);
      expect(result.hunks[0].lines[1].newLineNumber).toBe(11);
      expect(result.hunks[1].lines[1].newLineNumber).toBe(22);
    });

    it("handles complex real-world diff", () => {
      // Note: empty line must have a leading space to be part of diff context
      const patch = `@@ -80,5 +155,7 @@ .footer {
 text-align: center;
 }
 
-.logo {
-  animation: logo-spin;
+.logo-fixed {
+  animation: broken-spin;
 }`;

      const result = parseAndNumberDiff(patch);

      expect(result.hunks[0].lines[0].newLineNumber).toBe(155);
      expect(result.hunks[0].lines[0].content).toBe("text-align: center;");
      expect(result.hunks[0].lines[1].newLineNumber).toBe(156);
      expect(result.hunks[0].lines[1].content).toBe("}");
      expect(result.hunks[0].lines[2].newLineNumber).toBe(157);
      expect(result.hunks[0].lines[2].content).toBe("");
      expect(result.hunks[0].lines[3].newLineNumber).toBeUndefined(); // removed
      expect(result.hunks[0].lines[4].newLineNumber).toBeUndefined(); // removed
      expect(result.hunks[0].lines[5].newLineNumber).toBe(158); // added
      expect(result.hunks[0].lines[5].content).toBe(".logo-fixed {");
      expect(result.hunks[0].lines[6].newLineNumber).toBe(159); // added
      expect(result.hunks[0].lines[6].content).toBe("  animation: broken-spin;");
      expect(result.hunks[0].lines[7].newLineNumber).toBe(160); // context
    });

    it('ignores "no newline at end of file" marker', () => {
      const patch = `@@ -1,2 +1,2 @@
 line 1
-line 2
+line 2 modified
\\ No newline at end of file`;

      const result = parseAndNumberDiff(patch);

      expect(result.hunks[0].lines).toHaveLength(3);
    });
  });

  describe("formatNumberedDiff", () => {
    it("formats numbered diff with proper alignment", () => {
      const patch = `@@ -10,3 +10,4 @@ function test()
 context line
+added line
 context`;

      const numbered = parseAndNumberDiff(patch);
      const formatted = formatNumberedDiff(numbered);

      expect(formatted).toContain("@@ -10,3 +10,4 @@ function test()");
      expect(formatted).toContain("    10 | context line");
      expect(formatted).toContain("+    11 | added line");
      expect(formatted).toContain("    12 | context");
    });

    it("formats deleted lines with dash for line number", () => {
      const patch = `@@ -10,3 +10,2 @@
 context
-deleted line
 context`;

      const numbered = parseAndNumberDiff(patch);
      const formatted = formatNumberedDiff(numbered);

      expect(formatted).toContain("-     - | deleted line");
      expect(formatted).toContain("    10 | context");
      expect(formatted).toContain("    11 | context");
    });
  });

  describe("convertToNumberedDiff", () => {
    it("returns empty string for undefined", () => {
      expect(convertToNumberedDiff(undefined)).toBe("");
    });

    it("returns empty string for empty patch", () => {
      expect(convertToNumberedDiff("")).toBe("");
    });

    it("converts diff to numbered format", () => {
      const patch = `@@ -155,3 +155,4 @@ function calculateTotal(a, b) {
 return a + b;
+console.log(result);
 }`;

      const result = convertToNumberedDiff(patch);

      expect(result).toContain("   155 | return a + b;");
      expect(result).toContain("+   156 | console.log(result);");
      expect(result).toContain("   157 | }");
    });

    it("handles the example from the spec", () => {
      const patch = `@@ -10,3 +10,3 @@
 function calculateTotal(a, b) {
   return a + b;
 }`;

      const result = convertToNumberedDiff(patch);

      // Should show lines 10, 11, 12 clearly
      expect(result).toContain("    10 | function calculateTotal(a, b) {");
      expect(result).toContain("    11 |   return a + b;");
      expect(result).toContain("    12 | }");
    });
  });
});
