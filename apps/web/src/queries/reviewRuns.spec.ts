import { MutationObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PendingCommentView, PostCommentsResult } from "../server/review.types.js";
import type { RunSnapshot } from "../server/reviewRuns.server.js";
import { createTestQueryClient } from "../test/renderWithQuery.test-helper.js";
import {
  postCommentsMutation,
  type PostCommentsVariables,
  runInputOf,
  runQuery,
} from "./reviewRuns.js";

const fetchMock = vi.fn<typeof fetch>();

const snapshot: RunSnapshot = {
  manifest: {
    runId: "run-1",
    kind: "pr",
    targetKey: "pr:7",
    input: { pr: 7 },
    label: "PR #7",
    createdAt: 0,
    status: "done",
  },
  summary: null,
};

const comment: PendingCommentView = {
  body: "Fix this.",
  path: "src/a.ts",
  line: 3,
  fingerprint: "fp-1",
  posted: false,
};

const variables: PostCommentsVariables = { kind: "pr", target: { pr: 7 }, comments: [comment] };

const posted: PostCommentsResult = {
  commentsCreated: 1,
  commentsSkipped: 0,
  commentErrors: [],
  postedFingerprints: ["fp-1"],
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runQuery", () => {
  it("reads the run snapshot from the runs endpoint", async () => {
    fetchMock.mockResolvedValue(Response.json(snapshot));

    const result = await createTestQueryClient().fetchQuery(runQuery("run 1"));

    expect(result).toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith("/api/review/runs/run%201");
    expect(runInputOf(result)).toEqual({ pr: 7 });
  });

  it("is null for an unknown run instead of failing", async () => {
    fetchMock.mockResolvedValue(new Response("Unknown run", { status: 404 }));

    const result = await createTestQueryClient().fetchQuery(runQuery("gone"));

    expect(result).toBeNull();
    expect(runInputOf(result)).toBeNull();
  });

  it("fails on other server errors", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(createTestQueryClient().fetchQuery(runQuery("run-1"))).rejects.toThrow(
      "Review run lookup failed (HTTP 500)."
    );
  });

  it("keeps each run under its own key", () => {
    expect(runQuery("a").queryKey).not.toEqual(runQuery("b").queryKey);
  });
});

describe("runInputOf", () => {
  it("is null when nothing has been read yet", () => {
    expect(runInputOf(undefined)).toBeNull();
  });
});

describe("postCommentsMutation", () => {
  it("posts the comments with their target and re-reads stored runs", async () => {
    fetchMock.mockResolvedValue(Response.json(posted));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(runQuery("run-1").queryKey, snapshot);

    const result = await new MutationObserver(queryClient, postCommentsMutation).mutate(variables);

    expect(result).toEqual(posted);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/review/post");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ kind: "pr", pr: 7, comments: [comment] });
    expect(queryClient.getQueryState(runQuery("run-1").queryKey)?.isInvalidated).toBe(true);
  });

  it("reports the server's error message and leaves stored runs alone", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "No token" }, { status: 400 }));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(runQuery("run-1").queryKey, snapshot);
    const observer = new MutationObserver(queryClient, postCommentsMutation);

    await expect(observer.mutate(variables)).rejects.toThrow("No token");

    expect(observer.getCurrentResult().error?.message).toBe("No token");
    expect(queryClient.getQueryState(runQuery("run-1").queryKey)?.isInvalidated).toBe(false);
  });

  it("falls back to the HTTP status when the error has no message", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 502 }));
    await expect(
      new MutationObserver(createTestQueryClient(), postCommentsMutation).mutate(variables)
    ).rejects.toThrow("Failed to post comments (HTTP 502).");
  });

  it("can be found while in flight by its mutation key", async () => {
    let finish: ((response: Response) => void) | undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
    );
    const queryClient = createTestQueryClient();

    const pending = new MutationObserver(queryClient, postCommentsMutation).mutate(variables);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const inFlight = queryClient
      .getMutationCache()
      .findAll({ mutationKey: postCommentsMutation.mutationKey, status: "pending" });
    expect(inFlight.map((mutation) => mutation.state.variables)).toEqual([variables]);
    finish?.(Response.json(posted));
    await pending;
  });
});
