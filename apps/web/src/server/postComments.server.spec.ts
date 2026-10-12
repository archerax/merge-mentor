import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPostPRComments = vi.fn(async () => ({
  commentsCreated: 1,
  commentsSkipped: 0,
  commentErrors: [],
  postedFingerprints: ["fp"],
}));
const mockPostWorkItemComments = vi.fn(async () => ({
  commentsCreated: 2,
  commentsSkipped: 0,
  commentErrors: [],
  postedFingerprints: ["a", "b"],
}));

vi.mock("./review.server.js", () => ({ postPRComments: mockPostPRComments }));
vi.mock("./workItemReview.server.js", () => ({ postWorkItemComments: mockPostWorkItemComments }));

const { postComments } = await import("./postComments.server.js");

describe("postComments.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("input validation", () => {
    it("rejects non-object bodies", async () => {
      await expect(postComments(null)).rejects.toThrow("Invalid request body.");
      await expect(postComments("nope")).rejects.toThrow("Invalid request body.");
    });

    it("rejects an unknown kind", async () => {
      await expect(postComments({ kind: "widget", comments: [] })).rejects.toThrow(
        'Invalid "kind": expected "pr", "pbi", or "project".'
      );
    });

    it("rejects a non-array comments field", async () => {
      await expect(postComments({ kind: "pr", comments: "nope" })).rejects.toThrow(
        'Invalid "comments": expected an array.'
      );
    });
  });

  it("short-circuits when there are no valid comments", async () => {
    const result = await postComments({
      kind: "pr",
      comments: [null, "string", { path: "a.ts" }, { body: 42 }],
    });

    expect(result).toEqual({
      commentsCreated: 0,
      commentsSkipped: 0,
      commentErrors: [],
      postedFingerprints: [],
    });
    expect(mockPostPRComments).not.toHaveBeenCalled();
  });

  it("normalizes comments and dispatches PR reviews", async () => {
    const result = await postComments({
      kind: "pr",
      prUrl: "https://github.com/acme/widgets/pull/7",
      pr: 7,
      comments: [
        {
          body: "Fix this",
          path: "src/a.ts",
          line: 10,
          startLine: 8,
          existingCommentId: "99",
          extra: "ignored",
        },
        { body: "bad line", path: "src/b.ts", line: Number.NaN },
      ],
    });

    expect(mockPostPRComments).toHaveBeenCalledWith({
      kind: "pr",
      prUrl: "https://github.com/acme/widgets/pull/7",
      pr: 7,
      comments: [
        {
          body: "Fix this",
          path: "src/a.ts",
          line: 10,
          startLine: 8,
          existingCommentId: "99",
        },
        { body: "bad line", path: "src/b.ts" },
      ],
    });
    expect(mockPostWorkItemComments).not.toHaveBeenCalled();
    expect(result.commentsCreated).toBe(1);
  });

  it("dispatches PBI reviews", async () => {
    await postComments({ kind: "pbi", id: "42", comments: [{ body: "hi" }] });

    expect(mockPostWorkItemComments).toHaveBeenCalledWith(
      { kind: "pbi", id: "42", comments: [{ body: "hi" }] },
      "PBI"
    );
  });

  it("dispatches project reviews", async () => {
    await postComments({
      kind: "project",
      url: "https://dev.azure.com/org/proj/_workitems/edit/5",
      comments: [{ body: "hi" }],
    });

    expect(mockPostWorkItemComments).toHaveBeenCalledWith(
      {
        kind: "project",
        url: "https://dev.azure.com/org/proj/_workitems/edit/5",
        comments: [{ body: "hi" }],
      },
      "project"
    );
  });
});
