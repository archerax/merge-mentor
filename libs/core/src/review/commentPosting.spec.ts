import type { PlatformAdapter } from "@merge-mentor/domain/platform.js";
import { describe, expect, it, vi } from "vitest";

import { commentFingerprint, postPlannedComments, type PendingComment } from "./commentPosting.js";

/** Minimal adapter exposing only the posting methods under test. */
type PostingAdapter = Pick<
  PlatformAdapter,
  "postInlineComment" | "postGeneralComment" | "postPBIComment" | "postInlineCommentBatch"
>;

function createPostingAdapter(overrides: Partial<PostingAdapter> = {}): PostingAdapter {
  return {
    postInlineComment: vi.fn().mockResolvedValue(undefined),
    postGeneralComment: vi.fn().mockResolvedValue(undefined),
    postPBIComment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("postPlannedComments", () => {
  it("posts an inline PR comment for a path/line pair", async () => {
    const adapter = createPostingAdapter();
    const comment: PendingComment = { path: "src/a.ts", line: 12, body: "Fix this." };

    const result = await postPlannedComments(
      adapter as PlatformAdapter,
      { kind: "pr", prNumber: 7 },
      [comment]
    );

    expect(adapter.postInlineComment).toHaveBeenCalledWith(7, "src/a.ts", 12, "Fix this.");
    expect(adapter.postGeneralComment).not.toHaveBeenCalled();
    expect(result.commentsCreated).toBe(1);
    expect(result.commentsSkipped).toBe(0);
    expect(result.commentErrors).toEqual([]);
    expect(result.postedFingerprints).toEqual([commentFingerprint(comment)]);
  });

  it("passes startLine through for a multi-line inline comment", async () => {
    const adapter = createPostingAdapter();
    const comments: PendingComment[] = [
      { path: "src/a.ts", line: 20, startLine: 18, body: "Range." },
    ];

    await postPlannedComments(adapter as PlatformAdapter, { kind: "pr", prNumber: 7 }, comments);

    expect(adapter.postInlineComment).toHaveBeenCalledWith(7, "src/a.ts", 20, "Range.", 18);
  });

  it("falls back to a general comment when there is no path/line", async () => {
    const adapter = createPostingAdapter();
    const comments: PendingComment[] = [{ body: "Summary comment." }];

    await postPlannedComments(adapter as PlatformAdapter, { kind: "pr", prNumber: 7 }, comments);

    expect(adapter.postGeneralComment).toHaveBeenCalledWith(7, "Summary comment.");
    expect(adapter.postInlineComment).not.toHaveBeenCalled();
  });

  it("posts a work item comment and overwrites when an existing id is given", async () => {
    const adapter = createPostingAdapter();
    const comments: PendingComment[] = [{ body: "Review.", existingCommentId: 99 }];

    const result = await postPlannedComments(
      adapter as PlatformAdapter,
      { kind: "pbi", id: "12345" },
      comments
    );

    expect(adapter.postPBIComment).toHaveBeenCalledWith("12345", "Review.", 99);
    expect(result.commentsCreated).toBe(1);
  });

  it("collects per-comment failures and keeps posting the rest", async () => {
    const postInlineComment = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const adapter = createPostingAdapter({ postInlineComment });
    const comments: PendingComment[] = [
      { path: "a.ts", line: 1, body: "one" },
      { path: "b.ts", line: 2, body: "two" },
    ];

    const result = await postPlannedComments(
      adapter as PlatformAdapter,
      { kind: "pr", prNumber: 7 },
      comments
    );

    expect(result.commentsCreated).toBe(1);
    expect(result.commentsSkipped).toBe(0);
    expect(result.commentErrors).toHaveLength(1);
    expect(result.commentErrors[0]).toContain("boom");
    expect(postInlineComment).toHaveBeenCalledTimes(2);
    expect(result.postedFingerprints).toHaveLength(1);
  });

  it("skips comments whose fingerprint was already posted", async () => {
    const adapter = createPostingAdapter();
    const first: PendingComment = { path: "a.ts", line: 1, body: "already posted" };
    const second: PendingComment = { path: "b.ts", line: 2, body: "new one" };
    const postedFingerprints = new Set([commentFingerprint(first)]);

    const result = await postPlannedComments(
      adapter as PlatformAdapter,
      { kind: "pr", prNumber: 7 },
      [first, second],
      { postedFingerprints }
    );

    expect(adapter.postInlineComment).toHaveBeenCalledTimes(1);
    expect(adapter.postInlineComment).toHaveBeenCalledWith(7, "b.ts", 2, "new one");
    expect(result.commentsCreated).toBe(1);
    expect(result.commentsSkipped).toBe(1);
    expect(result.postedFingerprints).toEqual([commentFingerprint(second)]);
  });
});

describe("postPlannedComments batching", () => {
  const first: PendingComment = { path: "a.ts", line: 1, body: "one" };
  const second: PendingComment = { path: "b.ts", line: 4, startLine: 2, body: "two" };
  const general: PendingComment = { body: "overall" };
  const target = { kind: "pr", prNumber: 7 } as const;

  it("posts the inline comments as one review and the rest individually", async () => {
    const postInlineCommentBatch = vi.fn().mockResolvedValue(true);
    const adapter = createPostingAdapter({ postInlineCommentBatch });

    const result = await postPlannedComments(adapter as PlatformAdapter, target, [
      first,
      general,
      second,
    ]);

    expect(postInlineCommentBatch).toHaveBeenCalledTimes(1);
    expect(postInlineCommentBatch).toHaveBeenCalledWith(7, [
      { path: "a.ts", line: 1, body: "one" },
      { path: "b.ts", line: 4, startLine: 2, body: "two" },
    ]);
    expect(adapter.postInlineComment).not.toHaveBeenCalled();
    expect(adapter.postGeneralComment).toHaveBeenCalledWith(7, "overall");
    expect(result.commentsCreated).toBe(3);
    expect(result.commentErrors).toEqual([]);
    expect(result.postedFingerprints).toHaveLength(3);
  });

  it("posts each comment on its own when the platform rejects the batch", async () => {
    const postInlineCommentBatch = vi.fn().mockResolvedValue(false);
    const postInlineComment = vi
      .fn()
      .mockRejectedValueOnce(new Error("line not in diff"))
      .mockResolvedValueOnce(undefined);
    const adapter = createPostingAdapter({ postInlineCommentBatch, postInlineComment });

    const result = await postPlannedComments(adapter as PlatformAdapter, target, [first, second]);

    expect(postInlineComment).toHaveBeenCalledTimes(2);
    expect(result.commentsCreated).toBe(1);
    expect(result.commentErrors).toEqual(["Failed to post comment: line not in diff"]);
    expect(result.postedFingerprints).toEqual([commentFingerprint(second)]);
  });

  it("fails every comment in the batch, without falling back, on a hard error", async () => {
    const postInlineCommentBatch = vi.fn().mockRejectedValue(new Error("network down"));
    const adapter = createPostingAdapter({ postInlineCommentBatch });

    const result = await postPlannedComments(adapter as PlatformAdapter, target, [
      first,
      second,
      general,
    ]);

    expect(adapter.postInlineComment).not.toHaveBeenCalled();
    expect(result.commentErrors).toEqual([
      "Failed to post comment: network down",
      "Failed to post comment: network down",
    ]);
    expect(result.postedFingerprints).toEqual([commentFingerprint(general)]);
    expect(result.commentsCreated).toBe(1);
  });

  it("leaves out comments already posted", async () => {
    const postInlineCommentBatch = vi.fn().mockResolvedValue(true);
    const adapter = createPostingAdapter({ postInlineCommentBatch });
    const third: PendingComment = { path: "c.ts", line: 9, body: "three" };

    const result = await postPlannedComments(
      adapter as PlatformAdapter,
      target,
      [first, second, third],
      {
        postedFingerprints: new Set([commentFingerprint(first)]),
      }
    );

    expect(postInlineCommentBatch).toHaveBeenCalledWith(7, [
      { path: "b.ts", line: 4, startLine: 2, body: "two" },
      { path: "c.ts", line: 9, body: "three" },
    ]);
    expect(result.commentsCreated).toBe(2);
    expect(result.commentsSkipped).toBe(1);
  });

  it("does not batch work item comments", async () => {
    const postInlineCommentBatch = vi.fn().mockResolvedValue(true);
    const adapter = createPostingAdapter({ postInlineCommentBatch });

    await postPlannedComments(adapter as PlatformAdapter, { kind: "pbi", id: "5" }, [
      { path: "a.ts", line: 1, body: "x" },
      { path: "b.ts", line: 2, body: "y" },
    ]);

    expect(postInlineCommentBatch).not.toHaveBeenCalled();
    expect(adapter.postPBIComment).toHaveBeenCalledTimes(2);
  });
});

describe("commentFingerprint", () => {
  it("is stable for identical comments and independent of field order", () => {
    const comment: PendingComment = { path: "src/a.ts", line: 12, body: "Fix this." };
    expect(commentFingerprint(comment)).toBe(commentFingerprint({ ...comment }));
  });

  it("changes when the body, location, or existing comment changes", () => {
    const base: PendingComment = { path: "src/a.ts", line: 12, body: "Fix this." };
    expect(commentFingerprint(base)).not.toBe(commentFingerprint({ ...base, body: "Other." }));
    expect(commentFingerprint(base)).not.toBe(commentFingerprint({ ...base, line: 13 }));
    expect(commentFingerprint(base)).not.toBe(
      commentFingerprint({ body: "Fix this.", existingCommentId: 7 })
    );
  });

  it("distinguishes a range comment from a single-line comment", () => {
    const single: PendingComment = { path: "src/a.ts", line: 12, body: "Fix this." };
    const range: PendingComment = { ...single, startLine: 10 };
    expect(commentFingerprint(single)).not.toBe(commentFingerprint(range));
  });
});
