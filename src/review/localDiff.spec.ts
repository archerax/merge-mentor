import { describe, expect, it } from "vitest";
import {
  buildAddedFilePatch,
  buildContentDiffPatch,
  countPatchStats,
  extractNewPath,
  extractNewSha,
  hasContentHunks,
  isBinaryContent,
  splitGitDiff,
} from "./localDiff.js";

const SAMPLE_DIFF = `diff --git a/src/main.ts b/src/main.ts
index abc1234..def5678 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,3 +1,4 @@
 line1
-line2
+line2 changed
+line3
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..a1b2c3d 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+alpha
+beta
`;

describe("splitGitDiff", () => {
  it("splits combined diff output into per-file chunks", () => {
    const chunks = splitGitDiff(SAMPLE_DIFF);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].patch).toContain("diff --git a/src/main.ts b/src/main.ts");
    expect(chunks[1].patch).toContain("diff --git a/src/new.ts b/src/new.ts");
  });

  it("does not split on hunks or content lines", () => {
    const chunks = splitGitDiff(SAMPLE_DIFF);
    expect(chunks[0].hunks).toHaveLength(1);
    expect(chunks[0].hunks[0].header).toBe("@@ -1,3 +1,4 @@");
    expect(chunks[1].hunks).toHaveLength(1);
  });

  it("returns an empty array for empty input", () => {
    expect(splitGitDiff("")).toEqual([]);
  });
});

describe("countPatchStats", () => {
  it("counts added and deleted lines excluding headers", () => {
    const [chunk] = splitGitDiff(SAMPLE_DIFF);
    const stats = countPatchStats(chunk);
    expect(stats).toEqual({ additions: 2, deletions: 1 });
  });
});

describe("hasContentHunks", () => {
  it("returns true when hunks exist", () => {
    const [chunk] = splitGitDiff(SAMPLE_DIFF);
    expect(hasContentHunks(chunk)).toBe(true);
  });

  it("returns false for a rename-only chunk", () => {
    const [chunk] = splitGitDiff(`diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
`);
    expect(hasContentHunks(chunk)).toBe(false);
  });
});

describe("extractNewSha", () => {
  it("extracts the new blob sha from the index line", () => {
    const [chunk] = splitGitDiff(SAMPLE_DIFF);
    expect(extractNewSha(chunk)).toBe("def5678");
  });

  it("returns undefined for a deletion chunk", () => {
    const [chunk] = splitGitDiff(`diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index abc1234..0000000
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
`);
    expect(extractNewSha(chunk)).toBeUndefined();
  });
});

describe("extractNewPath", () => {
  it("extracts the path from the +++ line", () => {
    const [chunk] = splitGitDiff(SAMPLE_DIFF);
    expect(extractNewPath(chunk)).toBe("src/main.ts");
  });

  it("extracts the path from a rename header", () => {
    const [chunk] = splitGitDiff(`diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
`);
    expect(extractNewPath(chunk)).toBe("new.ts");
  });
});

describe("isBinaryContent", () => {
  it("returns true when content contains NUL bytes", () => {
    expect(isBinaryContent("a\u0000b")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(isBinaryContent("hello\nworld\n")).toBe(false);
  });
});

describe("buildAddedFilePatch", () => {
  it("builds a full-file-add unified diff with a trailing newline", () => {
    const patch = buildAddedFilePatch("src/new.ts", "alpha\nbeta\n", "a1b2c3d");
    expect(patch).toContain("diff --git a/src/new.ts b/src/new.ts");
    expect(patch).toContain("new file mode 100644");
    expect(patch).toContain("index 0000000..a1b2c3d 100644");
    expect(patch).toContain("--- /dev/null");
    expect(patch).toContain("+++ b/src/new.ts");
    expect(patch).toContain("@@ -0,0 +1,2 @@");
    expect(patch).toContain("+alpha\n+beta");
    expect(patch.endsWith("+beta\n")).toBe(true);
  });

  it("marks a missing trailing newline", () => {
    const patch = buildAddedFilePatch("src/new.ts", "alpha\nbeta");
    expect(patch).toContain("\\ No newline at end of file");
  });
});

describe("buildContentDiffPatch", () => {
  it("produces a git-style patch for a modification", () => {
    const patch = buildContentDiffPatch("f.ts", "line1\nline2\n", "line1\nline2 changed\nline3\n");
    expect(patch.startsWith("diff --git a/f.ts b/f.ts")).toBe(true);
    expect(patch).toContain("--- a/f.ts");
    expect(patch).toContain("+++ b/f.ts");
    expect(patch).toContain("@@ -1,2 +1,3 @@");
    expect(patch).toContain("-line2");
    expect(patch).toContain("+line2 changed");
    expect(patch).toContain("+line3");
  });
});
