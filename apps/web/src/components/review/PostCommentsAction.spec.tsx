import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PendingCommentView } from "../../server/review.types.js";
import { PostCommentsAction } from "./PostCommentsAction.js";

function renderHtml(ui: ReactNode): string {
  return renderToStaticMarkup(<MantineProvider>{ui}</MantineProvider>);
}

const target = { prUrl: "https://github.com/acme/widgets/pull/7" };

const pendingComment: PendingCommentView = {
  body: "Fix the off-by-one error.",
  path: "src/a.ts",
  line: 10,
  fingerprint: "fp-pending",
  posted: false,
};

const postedComment: PendingCommentView = {
  body: "Already posted.",
  path: "src/b.ts",
  line: 20,
  fingerprint: "fp-posted",
  posted: true,
};

describe("PostCommentsAction", () => {
  it("renders nothing when there are no planned comments", () => {
    const html = renderHtml(<PostCommentsAction kind="pr" target={target} comments={[]} />);
    expect(html).not.toContain("Post planned comments");
  });

  it("renders an individual Post button for each pending comment", () => {
    const html = renderHtml(
      <PostCommentsAction
        kind="pr"
        target={target}
        comments={[pendingComment, { ...pendingComment, path: "src/c.ts", fingerprint: "fp-2" }]}
      />
    );

    expect(html).toContain('aria-label="Post src/a.ts:10"');
    expect(html).toContain('aria-label="Post src/c.ts:10"');
    expect(html).toContain("Select from the 2 planned comments");
  });

  it("does not render a Post button for an already-posted comment", () => {
    const html = renderHtml(
      <PostCommentsAction kind="pr" target={target} comments={[postedComment]} />
    );

    expect(html).not.toContain('aria-label="Post src/b.ts:20"');
    expect(html).toContain("posted");
  });
});
