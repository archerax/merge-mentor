import type { PRFile } from "@merge-mentor/domain/platform.js";
import { describe, expect, it } from "vitest";

import {
  estimateDiffBytes,
  findUnreportedFiles,
  normalizeRepoPath,
  planReviewBatches,
  runWithConcurrency,
} from "./batching.js";

function file(filename: string, patchLines = 3): PRFile {
  return {
    filename,
    status: "modified",
    additions: patchLines,
    deletions: 0,
    patch: Array.from({ length: patchLines }, (_, i) => `+line ${i}`).join("\n"),
  };
}

describe("planReviewBatches", () => {
  it("keeps everything in one batch when it fits", () => {
    const batches = planReviewBatches([file("a.ts"), file("b.ts")], {
      maxBytes: 100_000,
      maxFiles: 10,
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it("splits on the file-count limit", () => {
    const files = ["a", "b", "c", "d", "e"].map((n) => file(`${n}.ts`));
    const batches = planReviewBatches(files, { maxBytes: 100_000, maxFiles: 2 });
    expect(batches.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it("splits on the byte budget", () => {
    const size = estimateDiffBytes(file("a.ts", 10));
    const files = [file("a.ts", 10), file("b.ts", 10), file("c.ts", 10)];
    const batches = planReviewBatches(files, { maxBytes: size * 2, maxFiles: 10 });
    expect(batches.map((b) => b.length)).toEqual([2, 1]);
  });

  it("gives an oversized file its own batch without dropping it", () => {
    const files = [file("a.ts"), file("big.ts", 500), file("c.ts")];
    const batches = planReviewBatches(files, { maxBytes: 200, maxFiles: 10 });
    expect(batches.flat()).toHaveLength(3);
    expect(batches.some((b) => b.length === 1 && b[0].filename === "big.ts")).toBe(true);
  });

  it("groups files by directory and keeps tests next to their source", () => {
    const files = [
      file("src/b/util.ts"),
      file("src/a/foo.spec.ts"),
      file("src/a/bar.ts"),
      file("src/a/foo.ts"),
    ];
    const [batch] = planReviewBatches(files, { maxBytes: 100_000, maxFiles: 10 });
    expect(batch.map((f) => f.filename)).toEqual([
      "src/a/bar.ts",
      "src/a/foo.spec.ts",
      "src/a/foo.ts",
      "src/b/util.ts",
    ]);
  });

  it("returns no batches for no files", () => {
    expect(planReviewBatches([], { maxBytes: 10, maxFiles: 1 })).toEqual([]);
  });
});

describe("runWithConcurrency", () => {
  it("preserves order and respects the limit", async () => {
    let active = 0;
    let peak = 0;
    const results = await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return n * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("findUnreportedFiles", () => {
  it("returns every file when nothing was reported", () => {
    expect(findUnreportedFiles([], ["a.ts", "b.ts"])).toEqual(["a.ts", "b.ts"]);
  });

  it("accepts exact paths, ./ prefixes and backslashes", () => {
    expect(findUnreportedFiles(["./src/a.ts", "src\\b.ts"], ["src/a.ts", "src/b.ts"])).toEqual([]);
  });

  it("attributes a repo-prefixed path to the longest matching file only", () => {
    expect(findUnreportedFiles(["x/src/a/index.ts"], ["a/index.ts", "src/a/index.ts"])).toEqual([
      "a/index.ts",
    ]);
  });

  it("lets an exact path cover only itself, not a suffix lookalike", () => {
    expect(findUnreportedFiles(["src/a/index.ts"], ["a/index.ts", "src/a/index.ts"])).toEqual([
      "a/index.ts",
    ]);
  });

  it("accepts a bare basename only when it identifies exactly one file", () => {
    expect(findUnreportedFiles(["index.ts"], ["a/index.ts", "b/other.ts"])).toEqual(["b/other.ts"]);
    expect(findUnreportedFiles(["index.ts"], ["a/index.ts", "b/index.ts"])).toEqual([
      "a/index.ts",
      "b/index.ts",
    ]);
  });
});

describe("normalizeRepoPath", () => {
  it("trims, converts backslashes and strips a leading ./", () => {
    expect(normalizeRepoPath("  .\\src\\a.ts ")).toBe("src/a.ts");
    expect(normalizeRepoPath("./src/a.ts")).toBe("src/a.ts");
  });
});
