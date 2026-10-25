// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PendingCommentView } from "../../server/review.types.js";
import { renderWithMantine } from "../../test/renderWithMantine.js";
import { commentLocation, PostableCommentRow } from "./commentView.js";
import type { PostCommentsController } from "./usePostComments.js";

function comment(overrides: Partial<PendingCommentView> = {}): PendingCommentView {
  return {
    body: "Fix the off-by-one error.",
    path: "src/a.ts",
    line: 10,
    fingerprint: "fp-1",
    posted: false,
    ...overrides,
  };
}

function controller(overrides: Partial<PostCommentsController> = {}): PostCommentsController {
  return {
    pending: [],
    selectedPending: [],
    allSelected: false,
    busy: false,
    targetReady: true,
    result: null,
    error: null,
    isPosted: () => false,
    isSelected: () => false,
    isPosting: () => false,
    rowError: () => undefined,
    toggle: vi.fn(),
    selectAll: vi.fn(),
    clearSelection: vi.fn(),
    postOne: vi.fn(),
    postSelected: vi.fn(),
    ...overrides,
  };
}

// The preview keeps 177 characters of the collapsed body plus the ellipsis.
const PREVIEW_LENGTH = 178;

describe("commentLocation", () => {
  it("returns the bare path when there is no line", () => {
    expect(commentLocation(comment({ line: undefined }))).toBe("src/a.ts");
  });

  it("returns path:line for a single-line comment", () => {
    expect(commentLocation(comment())).toBe("src/a.ts:10");
  });

  it("returns path:start-end for a multi-line comment", () => {
    expect(commentLocation(comment({ startLine: 7 }))).toBe("src/a.ts:7-10");
  });

  it("treats a start line equal to the line as a single line", () => {
    expect(commentLocation(comment({ startLine: 10 }))).toBe("src/a.ts:10");
  });

  it("describes a new work item comment", () => {
    expect(commentLocation(comment({ path: undefined, line: undefined }))).toBe(
      "Work item comment"
    );
  });

  it("describes a work item comment that updates an existing one", () => {
    expect(
      commentLocation(comment({ path: undefined, line: undefined, existingCommentId: 55 }))
    ).toBe("Work item comment (updates #55)");
  });
});

describe("PostableCommentRow", () => {
  it("renders the location, preview and Post button for a pending comment", () => {
    renderWithMantine(<PostableCommentRow comment={comment()} controller={controller()} />);

    expect(screen.getByText("src/a.ts:10")).toBeInTheDocument();
    expect(screen.getByText("Fix the off-by-one error.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Post src/a.ts:10" })).toBeEnabled();
    expect(screen.queryByText("posted")).not.toBeInTheDocument();
  });

  it("collapses whitespace and truncates long previews", () => {
    const body = `line one\n\n   line two ${"x".repeat(300)}`;
    renderWithMantine(<PostableCommentRow comment={comment({ body })} controller={controller()} />);

    const preview = screen.getByText(/^line one line two x+…$/);
    expect(preview.textContent).toHaveLength(PREVIEW_LENGTH);
  });

  it("toggles selection through the checkbox", async () => {
    const user = userEvent.setup();
    const ctl = controller();
    renderWithMantine(<PostableCommentRow comment={comment()} controller={ctl} />);

    await user.click(screen.getByRole("checkbox"));

    expect(ctl.toggle).toHaveBeenCalledWith("fp-1");
  });

  it("reflects the selected state in the checkbox", () => {
    renderWithMantine(
      <PostableCommentRow comment={comment()} controller={controller({ isSelected: () => true })} />
    );

    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("posts the comment from its Post button", async () => {
    const user = userEvent.setup();
    const ctl = controller();
    const pending = comment();
    renderWithMantine(<PostableCommentRow comment={pending} controller={ctl} />);

    await user.click(screen.getByRole("button", { name: "Post src/a.ts:10" }));

    expect(ctl.postOne).toHaveBeenCalledWith(pending);
  });

  it("shows a checked, disabled row with a posted badge and no Post button once posted", () => {
    renderWithMantine(
      <PostableCommentRow comment={comment()} controller={controller({ isPosted: () => true })} />
    );

    expect(screen.getByText("posted")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("disables posting while another post is in flight", () => {
    renderWithMantine(
      <PostableCommentRow comment={comment()} controller={controller({ busy: true })} />
    );

    expect(screen.getByRole("button", { name: "Post src/a.ts:10" })).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("disables posting when the target is not ready", () => {
    renderWithMantine(
      <PostableCommentRow comment={comment()} controller={controller({ targetReady: false })} />
    );

    expect(screen.getByRole("button", { name: "Post src/a.ts:10" })).toBeDisabled();
  });

  it("marks the Post button as loading while this comment is posting", () => {
    renderWithMantine(
      <PostableCommentRow
        comment={comment()}
        controller={controller({ isPosting: (fingerprint) => fingerprint === "fp-1" })}
      />
    );

    expect(screen.getByRole("button", { name: "Post src/a.ts:10" })).toHaveAttribute(
      "data-loading",
      "true"
    );
  });

  it("shows a row error", () => {
    renderWithMantine(
      <PostableCommentRow
        comment={comment()}
        controller={controller({ rowError: () => "Platform rejected the comment." })}
      />
    );

    expect(screen.getByText("Platform rejected the comment.")).toBeInTheDocument();
  });
});
