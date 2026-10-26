// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PendingCommentView, PostCommentsResult } from "../../server/review.types.js";
import { deferred } from "../../test/deferred.js";
import { jsonResponse } from "../../test/sse.js";
import { usePostComments } from "./usePostComments.js";

function comment(fingerprint: string, overrides: Partial<PendingCommentView> = {}) {
  return {
    body: `Body ${fingerprint}`,
    path: `src/${fingerprint}.ts`,
    line: 1,
    fingerprint,
    posted: false,
    ...overrides,
  } satisfies PendingCommentView;
}

function postResult(overrides: Partial<PostCommentsResult> = {}): PostCommentsResult {
  return {
    commentsCreated: 1,
    commentsSkipped: 0,
    commentErrors: [],
    postedFingerprints: [],
    ...overrides,
  };
}

const target = { prUrl: "https://github.com/acme/widgets/pull/7" };
const a = comment("a");
const b = comment("b");
const c = comment("c", { posted: true });

describe("usePostComments", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("excludes already-posted comments from pending and selects the rest by default", () => {
    const { result } = renderHook(() => usePostComments("pr", target, [a, b, c]));

    expect(result.current.pending.map((item) => item.fingerprint)).toEqual(["a", "b"]);
    expect(result.current.selectedPending.map((item) => item.fingerprint)).toEqual(["a", "b"]);
    expect(result.current.allSelected).toBe(true);
    expect(result.current.isPosted("c")).toBe(true);
    expect(result.current.isPosted("a")).toBe(false);
    expect(result.current.targetReady).toBe(true);
  });

  it("reports the target as not ready when it is missing", () => {
    const { result } = renderHook(() => usePostComments("pr", null, [a]));

    expect(result.current.targetReady).toBe(false);
  });

  it("toggles, clears and re-selects comments", () => {
    const { result } = renderHook(() => usePostComments("pr", target, [a, b]));

    act(() => result.current.toggle("a"));
    expect(result.current.isSelected("a")).toBe(false);
    expect(result.current.allSelected).toBe(false);

    act(() => result.current.toggle("a"));
    expect(result.current.isSelected("a")).toBe(true);

    act(() => result.current.clearSelection());
    expect(result.current.selectedPending).toEqual([]);

    act(() => result.current.selectAll());
    expect(result.current.allSelected).toBe(true);
  });

  it("resets the selection when the set of pending comments changes", () => {
    const { result, rerender } = renderHook(
      ({ comments }) => usePostComments("pr", target, comments),
      { initialProps: { comments: [a, b] } }
    );
    act(() => result.current.clearSelection());

    rerender({ comments: [a, b, comment("d")] });

    expect(result.current.selectedPending.map((item) => item.fingerprint)).toEqual(["a", "b", "d"]);
  });

  it("posts the selected batch and records the result", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(postResult({ commentsCreated: 2, postedFingerprints: ["a", "b"] }))
    );
    const { result } = renderHook(() => usePostComments("pr", target, [a, b]));

    act(() => result.current.postSelected());

    await waitFor(() => expect(result.current.result?.commentsCreated).toBe(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/review/post");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      kind: "pr",
      ...target,
      comments: [a, b],
    });
    expect(result.current.isPosted("a")).toBe(true);
    expect(result.current.isPosted("b")).toBe(true);
    expect(result.current.pending).toEqual([]);
    expect(result.current.busy).toBe(false);
  });

  it("posts only the comments left selected", async () => {
    fetchMock.mockResolvedValue(jsonResponse(postResult({ postedFingerprints: ["a"] })));
    const { result } = renderHook(() => usePostComments("pr", target, [a, b]));

    act(() => result.current.toggle("b"));
    act(() => result.current.postSelected());

    await waitFor(() => expect(result.current.isPosted("a")).toBe(true));
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).comments).toEqual([a]);
    expect(result.current.isPosted("b")).toBe(false);
  });

  it("is busy and marks rows as posting while a request is in flight", async () => {
    const response = deferred<Response>();
    fetchMock.mockReturnValue(response.promise);
    const { result } = renderHook(() => usePostComments("pr", target, [a, b]));

    act(() => result.current.postOne(a));

    await waitFor(() => expect(result.current.busy).toBe(true));
    expect(result.current.isPosting("a")).toBe(true);
    expect(result.current.isPosting("b")).toBe(false);

    await act(async () =>
      response.resolve(jsonResponse(postResult({ postedFingerprints: ["a"] })))
    );
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it("posts a single comment without setting the batch result", async () => {
    fetchMock.mockResolvedValue(jsonResponse(postResult({ postedFingerprints: ["a"] })));
    const { result } = renderHook(() => usePostComments("pr", target, [a, b]));

    act(() => result.current.postOne(a));

    await waitFor(() => expect(result.current.isPosted("a")).toBe(true));
    expect(result.current.result).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).comments).toEqual([a]);
  });

  it("surfaces platform errors for a single comment on its row", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        postResult({ commentsCreated: 0, commentErrors: ["Line not in diff.", "Retry."] })
      )
    );
    const { result } = renderHook(() => usePostComments("pr", target, [a]));

    act(() => result.current.postOne(a));

    await waitFor(() => expect(result.current.rowError("a")).toBe("Line not in diff. Retry."));
    expect(result.current.isPosted("a")).toBe(false);
  });

  it("clears a row error when the comment is retried", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "Boom" }, 500))
      .mockResolvedValueOnce(jsonResponse(postResult({ postedFingerprints: ["a"] })));
    const { result } = renderHook(() => usePostComments("pr", target, [a]));

    act(() => result.current.postOne(a));
    await waitFor(() => expect(result.current.rowError("a")).toBe("Boom"));

    act(() => result.current.postOne(a));
    await waitFor(() => expect(result.current.isPosted("a")).toBe(true));
    expect(result.current.rowError("a")).toBeUndefined();
  });

  it("uses the server error message for a failed batch", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Token expired" }, 401));
    const { result } = renderHook(() => usePostComments("pr", target, [a, b]));

    act(() => result.current.postSelected());

    await waitFor(() => expect(result.current.error).toBe("Token expired"));
    expect(result.current.result).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("falls back to a status message when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 502 }));
    const { result } = renderHook(() => usePostComments("pr", target, [a, b]));

    act(() => result.current.postSelected());

    await waitFor(() => expect(result.current.error).toBe("Failed to post comments (HTTP 502)."));
  });

  it("reports network failures", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => usePostComments("pr", target, [a, b]));

    act(() => result.current.postSelected());

    await waitFor(() => expect(result.current.error).toBe("offline"));
  });

  it("stringifies non-Error rejections", async () => {
    fetchMock.mockRejectedValue("kaput");
    const { result } = renderHook(() => usePostComments("pr", target, [a]));

    act(() => result.current.postOne(a));

    await waitFor(() => expect(result.current.rowError("a")).toBe("kaput"));
  });

  it("does not post without a target", () => {
    const { result } = renderHook(() => usePostComments("pr", null, [a]));

    act(() => result.current.postOne(a));
    act(() => result.current.postSelected());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not post a batch when nothing is selected", () => {
    const { result } = renderHook(() => usePostComments("pr", target, [a]));

    act(() => result.current.clearSelection());
    act(() => result.current.postSelected());

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
