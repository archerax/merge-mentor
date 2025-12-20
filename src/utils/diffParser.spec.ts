import { describe, it, expect } from 'vitest';
import { getValidDiffLines, findNearestValidLine, isValidDiffLine } from './diffParser.js';

describe('diffParser', () => {
  describe('getValidDiffLines', () => {
    it('returns empty set for undefined patch', () => {
      const validLines = getValidDiffLines(undefined);
      expect(validLines.size).toBe(0);
    });

    it('returns empty set for empty patch', () => {
      const validLines = getValidDiffLines('');
      expect(validLines.size).toBe(0);
    });

    it('extracts added lines correctly', () => {
      const patch = `@@ -10,3 +10,4 @@ function test() {
 context line
+added line 1
+added line 2
 context line`;
      
      const validLines = getValidDiffLines(patch);
      
      expect(validLines.has(10)).toBe(true); // context
      expect(validLines.has(11)).toBe(true); // added
      expect(validLines.has(12)).toBe(true); // added
      expect(validLines.has(13)).toBe(true); // context
    });

    it('handles deleted lines correctly', () => {
      const patch = `@@ -10,4 +10,2 @@ function test() {
 context line
-deleted line 1
-deleted line 2
 context line`;
      
      const validLines = getValidDiffLines(patch);
      
      expect(validLines.has(10)).toBe(true); // context
      expect(validLines.has(11)).toBe(true); // context (after deletions)
      expect(validLines.size).toBe(2);
    });

    it('handles multiple hunks', () => {
      const patch = `@@ -10,2 +10,3 @@ function test() {
 context
+added line
 context
@@ -20,2 +21,3 @@ function other() {
 context
+another added line
 context`;
      
      const validLines = getValidDiffLines(patch);
      
      expect(validLines.has(10)).toBe(true);
      expect(validLines.has(11)).toBe(true);
      expect(validLines.has(12)).toBe(true);
      expect(validLines.has(21)).toBe(true);
      expect(validLines.has(22)).toBe(true);
      expect(validLines.has(23)).toBe(true);
    });

    it('handles complex real-world diff', () => {
      const patch = `@@ -1,5 +1,6 @@
 {
   "dependencies": {
-    "old-package": "^1.0.0",
+    "new-package": "^2.0.0",
+    "another-package": "^1.0.0",
     "some-package": "^3.0.0"
   }`;
      
      const validLines = getValidDiffLines(patch);
      
      expect(validLines.has(1)).toBe(true);  // {
      expect(validLines.has(2)).toBe(true);  // "dependencies"
      expect(validLines.has(3)).toBe(true);  // new-package (replaced)
      expect(validLines.has(4)).toBe(true);  // another-package (added)
      expect(validLines.has(5)).toBe(true);  // some-package
    });

    it('ignores "no newline at end of file" marker', () => {
      const patch = `@@ -1,2 +1,2 @@
 line 1
-line 2
+line 2 modified
\\ No newline at end of file`;
      
      const validLines = getValidDiffLines(patch);
      
      expect(validLines.has(1)).toBe(true);
      expect(validLines.has(2)).toBe(true);
      expect(validLines.size).toBe(2);
    });
  });

  describe('findNearestValidLine', () => {
    it('returns undefined for empty set', () => {
      const result = findNearestValidLine(10, new Set());
      expect(result).toBeUndefined();
    });

    it('returns requested line if valid', () => {
      const validLines = new Set([10, 15, 20]);
      const result = findNearestValidLine(15, validLines);
      expect(result).toBe(15);
    });

    it('finds nearest line above', () => {
      const validLines = new Set([10, 20, 30]);
      const result = findNearestValidLine(12, validLines);
      expect(result).toBe(10);
    });

    it('finds nearest line below', () => {
      const validLines = new Set([10, 20, 30]);
      const result = findNearestValidLine(28, validLines);
      expect(result).toBe(30);
    });

    it('finds closest when equidistant (prefers lower)', () => {
      const validLines = new Set([10, 20]);
      const result = findNearestValidLine(15, validLines);
      expect(result).toBe(10);
    });

    it('handles single valid line', () => {
      const validLines = new Set([42]);
      const result = findNearestValidLine(100, validLines);
      expect(result).toBe(42);
    });
  });

  describe('isValidDiffLine', () => {
    it('returns true for valid line', () => {
      const validLines = new Set([10, 20, 30]);
      expect(isValidDiffLine(20, validLines)).toBe(true);
    });

    it('returns false for invalid line', () => {
      const validLines = new Set([10, 20, 30]);
      expect(isValidDiffLine(15, validLines)).toBe(false);
    });

    it('returns false for empty set', () => {
      expect(isValidDiffLine(10, new Set())).toBe(false);
    });
  });
});
