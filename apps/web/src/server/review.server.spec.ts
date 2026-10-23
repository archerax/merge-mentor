import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@merge-mentor/platforms/github.js", () => ({
  GitHubAdapter: class {
    getProjectIdentifier() {
      return "widgets";
    }
    getPlatformName() {
      return "github";
    }
  },
}));
vi.mock("@merge-mentor/platforms/azure.js", () => ({
  AzureDevOpsAdapter: class {
    getProjectIdentifier() {
      return "proj";
    }
    getPlatformName() {
      return "azure";
    }
  },
}));
vi.mock("@merge-mentor/core/review/engine.js", () => ({
  ReviewEngine: class {
    async reviewPR() {
      return {
        prDetails: {
          number: 7,
          title: "Add thing",
          description: "",
          author: "octocat",
          baseBranch: "main",
          headBranch: "feature",
        },
        filesReviewed: 1,
        filesSkipped: 0,
        filesIgnored: 0,
        ignoredFiles: [],
        fileResults: [
          {
            filename: "src/a.ts",
            findings: [
              {
                file: "src/a.ts",
                line: 3,
                severity: "high",
                category: "bug",
                message: "bad",
                suggestion: "fix",
                isPreExisting: false,
              },
            ],
          },
        ],
        crossFileResult: {
          overallAssessment: "fine",
          findings: [
            {
              severity: "medium",
              confidence: "high",
              category: "bug",
              message: "cross",
              reasoning: "why",
              affectedFiles: ["src/a.ts", "src/b.ts"],
            },
          ],
          recommendations: ["do better"],
        },
        commentsCreated: 0,
        commentErrors: [],
        plannedComments: [{ type: "create", path: "src/a.ts", line: 3, body: "hi" }],
        linesAdded: 5,
        linesDeleted: 2,
      };
    }
  },
}));
vi.mock("@merge-mentor/core/review/reviewReport.js", () => ({
  saveReviewReport: vi.fn(() => "/tmp/report.md"),
}));
vi.mock("@merge-mentor/core/review/commentPosting.js", () => ({
  commentFingerprint: (comment: { body?: string }) => `fp:${comment.body ?? ""}`,
  postPlannedComments: vi.fn(async () => ({
    commentsCreated: 1,
    commentsSkipped: 0,
    commentErrors: [],
    postedFingerprints: ["fp:hi"],
  })),
}));

const { postPlannedComments } = await import("@merge-mentor/core/review/commentPosting.js");
const { getPRCacheStatus, startPRReview, postPRComments } = await import("./review.server.js");
const { streamRun } = await import("./reviewRuns.server.js");
const { saveReviewReport } = await import("@merge-mentor/core/review/reviewReport.js");

async function collectFrames(
  stream: ReadableStream<Uint8Array>
): Promise<Record<string, unknown>[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
  }
  return output
    .split("\n\n")
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => chunk.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => !!line)
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

/** Starts a run and collects its frames through the registry stream. */
async function collectRun(start: () => { runId: string }): Promise<Record<string, unknown>[]> {
  const { runId } = start();
  const stream = streamRun(runId, 0);
  expect(stream).not.toBeNull();
  return collectFrames(stream as ReadableStream<Uint8Array>);
}

describe("review.server", () => {
  let tempDir: string;
  let envFile: string;
  const originalEnvFile = process.env.MM_ENV_FILE;
  const originalTempPath = process.env.MM_TEMP_PATH;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-review-"));
    envFile = path.join(tempDir, ".env");
    fs.writeFileSync(
      envFile,
      [
        "MM_PLATFORM=github",
        "MM_GITHUB_TOKEN=ghp_token",
        "MM_GITHUB_REPO_OWNER=acme",
        "MM_GITHUB_REPO_NAME=widgets",
        "",
      ].join("\n"),
      "utf8"
    );
    process.env.MM_ENV_FILE = envFile;
    process.env.MM_TEMP_PATH = tempDir;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalEnvFile === undefined) delete process.env.MM_ENV_FILE;
    else process.env.MM_ENV_FILE = originalEnvFile;
    if (originalTempPath === undefined) delete process.env.MM_TEMP_PATH;
    else process.env.MM_TEMP_PATH = originalTempPath;
  });

  describe("postPRComments", () => {
    it("resolves the target, posts planned comments, and records fingerprints", async () => {
      const result = await postPRComments({
        kind: "pr",
        pr: 7,
        comments: [{ body: "hi" }],
      });

      expect(result.commentsCreated).toBe(1);
      expect(postPlannedComments).toHaveBeenCalledTimes(1);
      const [adapter, target, comments, options] = vi.mocked(postPlannedComments).mock.calls[0];
      expect(adapter).toBeDefined();
      expect(target).toEqual({ kind: "pr", prNumber: 7 });
      expect(comments).toEqual([{ body: "hi" }]);
      expect(options?.postedFingerprints).toBeInstanceOf(Set);

      const store = path.join(tempDir, "posted-comments.json");
      expect(fs.existsSync(store)).toBe(true);
      expect(fs.readFileSync(store, "utf8")).toContain("fp:hi");
    });

    it("rejects a missing PR reference", async () => {
      await expect(postPRComments({ kind: "pr", comments: [] })).rejects.toThrow(
        "Provide a PR URL or a PR number to run a review."
      );
    });

    it("rejects a non-positive PR number", async () => {
      await expect(postPRComments({ kind: "pr", pr: 0, comments: [] })).rejects.toThrow(
        "PR number must be a positive integer."
      );
    });

    it("derives the target from a PR URL", async () => {
      await postPRComments({
        kind: "pr",
        prUrl: "https://github.com/acme/widgets/pull/99",
        comments: [{ body: "hi" }],
      });

      const [, target] = vi.mocked(postPlannedComments).mock.calls[0];
      expect(target).toEqual({ kind: "pr", prNumber: 99 });
    });
  });

  describe("getPRCacheStatus", () => {
    it("reports not cached when no state exists", async () => {
      expect(await getPRCacheStatus({ pr: 7 })).toEqual({ cached: false });
    });

    it("reports cached state with timestamp and file count", async () => {
      fs.mkdirSync(path.join(tempDir, "cache"), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "cache", "Github-widgets-PR7.json"),
        JSON.stringify({
          prIdentifier: "Github-widgets-PR7",
          lastReviewedAt: "2024-04-18T12:34:56Z",
          files: { "a.ts": {}, "b.ts": {} },
        })
      );
      expect(await getPRCacheStatus({ pr: 7 })).toEqual({
        cached: true,
        lastReviewedAt: "2024-04-18T12:34:56Z",
        cachedFiles: 2,
      });
    });

    it("reports not cached for an unresolvable target", async () => {
      expect(await getPRCacheStatus({})).toEqual({ cached: false });
    });
  });

  describe("startPRReview", () => {
    it("streams a completed review with findings and planned comments", async () => {
      const frames = await collectRun(() => startPRReview({ pr: 7, write: false }));

      const result = frames.find((frame) => frame.type === "result");
      expect(result).toBeDefined();
      const summary = result?.summary as Record<string, unknown>;
      expect(summary).toMatchObject({
        platform: "github",
        number: 7,
        url: "https://github.com/acme/widgets/pull/7",
        dryRun: true,
        filesReviewed: 1,
      });
      expect((summary.findings as unknown[]).length).toBe(1);
      expect((summary.crossFileFindings as unknown[]).length).toBe(1);
      expect((summary.pendingComments as unknown[]).length).toBe(1);
      expect(saveReviewReport).toHaveBeenCalledTimes(1);
    });

    it("terminates the stream with a done frame", async () => {
      const frames = await collectRun(() => startPRReview({ pr: 7 }));
      expect(frames.at(-1)).toMatchObject({ type: "done" });
    });

    it("does not expose pending comments in write mode", async () => {
      const frames = await collectRun(() => startPRReview({ pr: 7, write: true }));

      const result = frames.find((frame) => frame.type === "result");
      const summary = result?.summary as Record<string, unknown>;
      expect(summary.dryRun).toBe(false);
      expect(summary.pendingComments).toEqual([]);
    });

    it("applies a non-multi-agent strategy override", async () => {
      const frames = await collectRun(() => startPRReview({ pr: 7, strategy: "fast" }));
      expect(frames.some((frame) => frame.type === "result")).toBe(true);
    });

    it("attaches a duplicate submit to the in-flight run", async () => {
      const first = startPRReview({ pr: 7, write: false });
      const second = startPRReview({ pr: 7, write: false });
      expect(second).toEqual({ runId: first.runId, attached: true });

      await collectFrames(streamRun(first.runId, 0) as ReadableStream<Uint8Array>);
    });

    it("starts a distinct run when re-review is requested", async () => {
      const normal = startPRReview({ pr: 7 });
      const re = startPRReview({ pr: 7, reReview: true });
      expect(re.attached).toBe(false);

      await Promise.all([
        collectFrames(streamRun(normal.runId, 0) as ReadableStream<Uint8Array>),
        collectFrames(streamRun(re.runId, 0) as ReadableStream<Uint8Array>),
      ]);
    });

    it("starts a distinct run when the review runs differ", async () => {
      const single = startPRReview({ pr: 7 });
      const triple = startPRReview({ pr: 7, runs: 3 });
      expect(triple.attached).toBe(false);
      expect(triple.runId).not.toBe(single.runId);

      await Promise.all([
        collectFrames(streamRun(single.runId, 0) as ReadableStream<Uint8Array>),
        collectFrames(streamRun(triple.runId, 0) as ReadableStream<Uint8Array>),
      ]);
    });

    it("rejects a non-positive or fractional runs override", () => {
      expect(() => startPRReview({ pr: 7, runs: 0 })).toThrow(/positive integer/);
      expect(() => startPRReview({ pr: 7, runs: 1.5 })).toThrow(/positive integer/);
    });

    it("starts a distinct run when the write mode differs", async () => {
      const dry = startPRReview({ pr: 7, write: false });
      const write = startPRReview({ pr: 7, write: true });
      expect(write.attached).toBe(false);
      expect(write.runId).not.toBe(dry.runId);

      await Promise.all([
        collectFrames(streamRun(dry.runId, 0) as ReadableStream<Uint8Array>),
        collectFrames(streamRun(write.runId, 0) as ReadableStream<Uint8Array>),
      ]);
    });

    it("starts a distinct run when the strategy differs", async () => {
      const fast = startPRReview({ pr: 7, strategy: "fast" });
      const multi = startPRReview({ pr: 7, strategy: "multi-agent" });
      expect(multi.attached).toBe(false);
      expect(multi.runId).not.toBe(fast.runId);

      await Promise.all([
        collectFrames(streamRun(fast.runId, 0) as ReadableStream<Uint8Array>),
        collectFrames(streamRun(multi.runId, 0) as ReadableStream<Uint8Array>),
      ]);
    });

    it("rejects missing input", () => {
      expect(() => startPRReview({})).toThrow("Provide a PR URL or a PR number to run a review.");
    });

    it("rejects an invalid PR number", () => {
      expect(() => startPRReview({ pr: -1 })).toThrow("PR number must be a positive integer.");
    });
  });
});
