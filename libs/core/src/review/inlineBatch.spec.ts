import type { InlineCommentInput, PlatformAdapter } from "@merge-mentor/domain/platform.js";
import { describe, expect, it, vi } from "vitest";

import { postInlineBatch } from "./inlineBatch.js";

const COMMENTS: readonly InlineCommentInput[] = [
  { path: "a.ts", line: 1, body: "one" },
  { path: "b.ts", line: 2, startLine: 1, body: "two" },
];

function adapterWith(batch?: PlatformAdapter["postInlineCommentBatch"]): PlatformAdapter {
  return { postInlineCommentBatch: batch } as unknown as PlatformAdapter;
}

describe("postInlineBatch", () => {
  it("reports posted when the adapter posts the batch", async () => {
    const batch = vi.fn().mockResolvedValue(true);

    const outcome = await postInlineBatch(adapterWith(batch), 7, COMMENTS);

    expect(outcome).toEqual({ status: "posted" });
    expect(batch).toHaveBeenCalledWith(7, COMMENTS);
  });

  it("falls back when the adapter rejects the batch's content", async () => {
    const batch = vi.fn().mockResolvedValue(false);

    expect(await postInlineBatch(adapterWith(batch), 7, COMMENTS)).toEqual({
      status: "fallback",
    });
  });

  it("falls back when the adapter cannot batch", async () => {
    expect(await postInlineBatch(adapterWith(undefined), 7, COMMENTS)).toEqual({
      status: "fallback",
    });
  });

  it("falls back, without calling the adapter, for fewer than two comments", async () => {
    const batch = vi.fn().mockResolvedValue(true);

    expect(await postInlineBatch(adapterWith(batch), 7, [])).toEqual({ status: "fallback" });
    expect(
      await postInlineBatch(adapterWith(batch), 7, [{ path: "a.ts", line: 1, body: "one" }])
    ).toEqual({
      status: "fallback",
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it("reports failed, never falling back, when the adapter throws", async () => {
    const error = new Error("network down");
    const batch = vi.fn().mockRejectedValue(error);

    expect(await postInlineBatch(adapterWith(batch), 7, COMMENTS)).toEqual({
      status: "failed",
      error,
    });
    expect(batch).toHaveBeenCalledTimes(1);
  });
});
