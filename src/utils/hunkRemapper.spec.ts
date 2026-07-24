import { describe, expect, it } from "vitest";
import { remapLineNumber } from "./hunkRemapper.js";

describe("remapLineNumber", () => {
  it("returns original line when no patch is provided", () => {
    expect(remapLineNumber(42, undefined)).toBe(42);
  });

  it("returns original line when originalLine is 0 or negative", () => {
    expect(remapLineNumber(0, "some patch")).toBe(0);
    expect(remapLineNumber(-1, "some patch")).toBe(-1);
  });

  it("returns original for a line before the first hunk", () => {
    const patch = `@@ -10,7 +10,9 @@
 context
+added
 context
-removed
 context
 context
+added2
 context`;
    expect(remapLineNumber(5, patch)).toBe(5);
  });

  it("remaps a line at the first hunk line (no offset)", () => {
    const patch = `@@ -10,7 +10,9 @@
 context
+added
 context
-removed
 context
 context
+added2
 context`;
    expect(remapLineNumber(10, patch)).toBe(10);
  });

  it("remaps a context line after an addition", () => {
    const patch = `@@ -10,7 +10,9 @@
 context
+added line 1
 context
-removed line
 context
 context
+added line 2
 context`;
    expect(remapLineNumber(11, patch)).toBe(12);
    expect(remapLineNumber(15, patch)).toBe(16);
  });

  it("returns originalLine for a deleted line", () => {
    const patch = `@@ -10,7 +10,9 @@
 context
+added line 1
 context
-removed line
 context
 context
+added line 2
 context`;
    expect(remapLineNumber(12, patch)).toBe(12);
  });

  it("returns original for a line beyond the patch range", () => {
    const patch = `@@ -10,7 +10,9 @@
 context
+added
 context
-removed
 context
 context
+added2
 context`;
    expect(remapLineNumber(999, patch)).toBe(999);
  });

  it("handles a patch with only deletions", () => {
    const patch = `@@ -5,4 +5,2 @@
 line5
-line6
-line7
 line8`;
    expect(remapLineNumber(5, patch)).toBe(5);
    expect(remapLineNumber(6, patch)).toBe(6);
    expect(remapLineNumber(7, patch)).toBe(7);
    expect(remapLineNumber(8, patch)).toBe(6);
  });

  it("handles a patch with only additions", () => {
    const patch = `@@ -1,2 +1,4 @@
 line1
+added1
+added2
 line2`;
    expect(remapLineNumber(1, patch)).toBe(1);
    expect(remapLineNumber(2, patch)).toBe(4);
  });
});
