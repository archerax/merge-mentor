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
const { createReviewStream, postPRComments } = await import("./review.server.js");
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
    .map((chunk) => JSON.parse(chunk.replace(/^data: /, "")) as Record<string, unknown>);
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

  describe("createReviewStream", () => {
    it("streams a completed review with findings and planned comments", async () => {
      const frames = await collectFrames(createReviewStream({ pr: 7, write: false }));

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

    it("does not expose pending comments in write mode", async () => {
      const frames = await collectFrames(createReviewStream({ pr: 7, write: true }));

      const result = frames.find((frame) => frame.type === "result");
      const summary = result?.summary as Record<string, unknown>;
      expect(summary.dryRun).toBe(false);
      expect(summary.pendingComments).toEqual([]);
    });

    it("applies a non-multi-agent strategy override", async () => {
      const frames = await collectFrames(createReviewStream({ pr: 7, strategy: "fast" }));
      expect(frames.some((frame) => frame.type === "result")).toBe(true);
    });

    it("emits an error frame for missing input", async () => {
      const frames = await collectFrames(createReviewStream({}));
      expect(frames.at(0)).toMatchObject({ type: "status" });
      expect(frames.at(-1)).toMatchObject({
        type: "error",
        message: "Provide a PR URL or a PR number to run a review.",
      });
    });

    it("emits an error frame for an invalid PR number", async () => {
      const frames = await collectFrames(createReviewStream({ pr: -1 }));
      expect(frames.at(-1)).toMatchObject({
        type: "error",
        message: "PR number must be a positive integer.",
      });
    });
  });
});
