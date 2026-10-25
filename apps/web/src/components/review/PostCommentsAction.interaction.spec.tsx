// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PendingCommentView, PostCommentsResult } from "../../server/review.types.js";
import { renderWithMantine } from "../../test/renderWithMantine.js";
import { PostCommentsAction } from "./PostCommentsAction.js";

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

function mockPost(result: Partial<PostCommentsResult>): void {
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        commentsCreated: 0,
        commentsSkipped: 0,
        commentErrors: [],
        postedFingerprints: [],
        ...result,
      }),
      { status: 200 }
    )
  );
}

const target = { prUrl: "https://github.com/acme/widgets/pull/7" };

describe("PostCommentsAction interactions", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts every selected comment and reports the result", async () => {
    const user = userEvent.setup();
    mockPost({ commentsCreated: 2, postedFingerprints: ["a", "b"] });
    renderWithMantine(
      <PostCommentsAction kind="pr" target={target} comments={[comment("a"), comment("b")]} />
    );

    await user.click(screen.getByRole("button", { name: "Post 2 comments" }));

    expect(await screen.findByText("Comments posted")).toBeInTheDocument();
    expect(screen.getByText(/2 comments posted\./)).toBeInTheDocument();
    expect(screen.getByText("All planned comments have been posted.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Post \d+ comment/ })).not.toBeInTheDocument();
  });

  it("posts only the comments left selected", async () => {
    const user = userEvent.setup();
    mockPost({ commentsCreated: 1, postedFingerprints: ["b"] });
    renderWithMantine(
      <PostCommentsAction kind="pr" target={target} comments={[comment("a"), comment("b")]} />
    );

    await user.click(screen.getAllByRole("checkbox")[0]);
    await user.click(screen.getByRole("button", { name: "Post 1 comment" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.comments.map((item: PendingCommentView) => item.fingerprint)).toEqual(["b"]);
  });

  it("clears and re-selects all comments from the header buttons", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PostCommentsAction kind="pr" target={target} comments={[comment("a"), comment("b")]} />
    );
    const selectAll = screen.getByRole("button", { name: "Select all" });
    const clear = screen.getByRole("button", { name: "Clear" });

    expect(selectAll).toBeDisabled();

    await user.click(clear);
    const [first, second] = screen.getAllByRole("checkbox");
    expect(first).not.toBeChecked();
    expect(second).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Post 0 comments" })).toBeDisabled();

    await user.click(selectAll);
    expect(screen.getByRole("button", { name: "Post 2 comments" })).toBeEnabled();
  });

  it("posts a single comment from its row button and marks it posted", async () => {
    const user = userEvent.setup();
    mockPost({ commentsCreated: 1, postedFingerprints: ["a"] });
    renderWithMantine(
      <PostCommentsAction kind="pr" target={target} comments={[comment("a"), comment("b")]} />
    );

    await user.click(screen.getByRole("button", { name: "Post src/a.ts:1" }));

    expect(await screen.findByText("posted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Post src/a.ts:1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Post src/b.ts:1" })).toBeInTheDocument();
  });

  it("warns when a batch is only partially posted and mentions skipped comments", async () => {
    const user = userEvent.setup();
    mockPost({
      commentsCreated: 1,
      commentsSkipped: 1,
      commentErrors: ["src/b.ts: line not in diff"],
      postedFingerprints: ["a"],
    });
    renderWithMantine(
      <PostCommentsAction kind="pr" target={target} comments={[comment("a"), comment("b")]} />
    );

    await user.click(screen.getByRole("button", { name: "Post 2 comments" }));

    expect(await screen.findByText("Comments partially posted")).toBeInTheDocument();
    expect(screen.getByText(/1 comment posted\. 1 already posted, skipped\./)).toBeInTheDocument();
    expect(screen.getByText("src/b.ts: line not in diff")).toBeInTheDocument();
  });

  it("shows the batch error when the request fails", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "Token expired" }), { status: 401 })
    );
    renderWithMantine(
      <PostCommentsAction kind="pr" target={target} comments={[comment("a"), comment("b")]} />
    );

    await user.click(screen.getByRole("button", { name: "Post 2 comments" }));

    expect(await screen.findByText("Token expired")).toBeInTheDocument();
  });

  it("disables posting when there is no target", () => {
    renderWithMantine(<PostCommentsAction kind="pr" target={null} comments={[comment("a")]} />);

    expect(screen.getByRole("button", { name: "Post 1 comment" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Post src/a.ts:1" })).toBeDisabled();
  });

  it("pluralises the pending summary", () => {
    renderWithMantine(<PostCommentsAction kind="pr" target={target} comments={[comment("a")]} />);

    expect(screen.getByText(/Select from the 1 planned comment to post/)).toBeInTheDocument();
  });

  it("shows only posted rows when every comment is already posted", () => {
    renderWithMantine(
      <PostCommentsAction kind="pr" target={target} comments={[comment("a", { posted: true })]} />
    );

    expect(screen.getByText("posted")).toBeInTheDocument();
    expect(screen.getByText("All planned comments have been posted.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select all" })).not.toBeInTheDocument();
  });
});
