import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@merge-mentor/core/ai/providerFactory.js", () => ({
  createAIProvider: vi.fn(() => ({})),
}));
vi.mock("@merge-mentor/platforms/github.js", () => ({
  GitHubAdapter: class {
    getProjectIdentifier() {
      return "widgets";
    }
  },
}));
vi.mock("@merge-mentor/platforms/azure.js", () => ({
  AzureDevOpsAdapter: class {
    getProjectIdentifier() {
      return "proj";
    }
  },
}));
vi.mock("@merge-mentor/core/review/pbiEngine.js", () => ({
  PBIReviewEngine: class {
    async reviewPBI() {
      return {
        title: "Backlog item",
        overall_assessment: "looks good",
        suggestions: ["add AC"],
        reportMarkdown: "# report",
      };
    }
  },
}));
vi.mock("@merge-mentor/core/review/projectEngine.js", () => ({
  ProjectReviewEngine: class {
    async reviewProject() {
      return {
        title: "Epic",
        completeness_assessment: "complete",
        dependency_risks: "none",
        acceptance_criteria_alignment: "aligned",
        estimation_consistency: "consistent",
        overall_assessment: "healthy",
        confidence: "high",
        findings: [
          {
            work_item_id: "1",
            dimension: "testing",
            severity: "low",
            issue: "no tests",
            recommendation: "add tests",
          },
        ],
        suggestions: ["split"],
        reportMarkdown: "# plan",
      };
    }
  },
}));
vi.mock("@merge-mentor/core/review/commentPosting.js", () => ({
  commentFingerprint: (comment: { body?: string }) => `fp:${comment.body ?? ""}`,
  postPlannedComments: vi.fn(async () => ({
    commentsCreated: 1,
    commentsSkipped: 0,
    commentErrors: [],
    postedFingerprints: ["fp:# report"],
  })),
}));

const { postPlannedComments } = await import("@merge-mentor/core/review/commentPosting.js");
const { createPBIReviewStream, createProjectReviewStream, postWorkItemComments } =
  await import("./workItemReview.server.js");

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

describe("workItemReview.server", () => {
  let tempDir: string;
  let envFile: string;
  const originalEnvFile = process.env.MM_ENV_FILE;
  const originalTempPath = process.env.MM_TEMP_PATH;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-workitem-"));
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

  describe("createPBIReviewStream", () => {
    it("streams a PBI review result", async () => {
      const frames = await collectFrames(createPBIReviewStream({ id: "42" }));
      const result = frames.find((frame) => frame.type === "result");
      expect(result?.summary).toMatchObject({
        id: "42",
        title: "Backlog item",
        dryRun: true,
      });
    });

    it("emits an error frame when no id or url is given", async () => {
      const frames = await collectFrames(createPBIReviewStream({}));
      expect(frames.at(-1)).toMatchObject({
        type: "error",
        message: "Provide a PBI URL or ID to run a review.",
      });
    });
  });

  describe("createProjectReviewStream", () => {
    it("streams a project review result", async () => {
      const frames = await collectFrames(createProjectReviewStream({ id: "10" }));
      const result = frames.find((frame) => frame.type === "result");
      expect(result?.summary).toMatchObject({
        id: "10",
        title: "Epic",
        confidence: "high",
      });
      const summary = result?.summary as Record<string, unknown> | undefined;
      expect(summary?.findings).toHaveLength(1);
    });

    it("emits an error frame when no id or url is given", async () => {
      const frames = await collectFrames(createProjectReviewStream({}));
      expect(frames.at(-1)).toMatchObject({
        type: "error",
        message: "Provide a project URL or ID to run a review.",
      });
    });
  });

  describe("postWorkItemComments", () => {
    it("posts PBI comments and records fingerprints", async () => {
      const result = await postWorkItemComments(
        { kind: "pbi", id: "42", comments: [{ body: "# report" }] },
        "PBI"
      );

      expect(result.commentsCreated).toBe(1);
      const [, target, , options] = vi.mocked(postPlannedComments).mock.calls[0];
      expect(target).toEqual({ kind: "pbi", id: "42" });
      expect(options?.postedFingerprints).toBeInstanceOf(Set);

      const store = path.join(tempDir, "posted-comments.json");
      expect(fs.readFileSync(store, "utf8")).toContain("fp:# report");
    });

    it("posts project comments", async () => {
      await postWorkItemComments(
        { kind: "project", id: "10", comments: [{ body: "x" }] },
        "project"
      );

      const [, target] = vi.mocked(postPlannedComments).mock.calls[0];
      expect(target).toEqual({ kind: "project", id: "10" });
    });

    it("rejects a missing work item reference", async () => {
      await expect(postWorkItemComments({ kind: "pbi", comments: [] }, "PBI")).rejects.toThrow(
        "Provide a PBI URL or ID to run a review."
      );
    });
  });
});
