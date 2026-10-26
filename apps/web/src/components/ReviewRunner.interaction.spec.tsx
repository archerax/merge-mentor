// @vitest-environment jsdom
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PendingCommentView, ReviewSummary } from "../server/review.types.js";
import { useReviewForm } from "../stores/reviewForms.js";
import { renderWithMantine } from "../test/renderWithMantine.js";
import { jsonResponse, sseFrames, sseResponse } from "../test/sse.js";

vi.mock("../server/review.functions.js", () => ({ getReviewCacheStatus: vi.fn() }));

const { getReviewCacheStatus } = await import("../server/review.functions.js");
const { ReviewResult, ReviewRunner } = await import("./ReviewRunner.js");

function buildSummary(overrides: Partial<ReviewSummary> = {}): ReviewSummary {
  return {
    platform: "github",
    number: 7,
    title: "Add widget",
    author: "octocat",
    baseBranch: "main",
    headBranch: "feature",
    url: "https://github.com/acme/widgets/pull/7",
    filesReviewed: 3,
    filesSkipped: 1,
    filesIgnored: 0,
    linesAdded: 20,
    linesDeleted: 4,
    findings: [
      {
        file: "src/a.ts",
        line: 10,
        severity: "critical",
        category: "bug",
        message: "Off-by-one error.",
        suggestion: "Use <= instead of <.",
      },
      {
        file: "src/b.ts",
        line: 0,
        severity: "low",
        category: "style",
        message: "Prefer const.",
        isPreExisting: true,
      },
    ],
    crossFileFindings: [
      { line: 0, severity: "high", category: "design", message: "Layering violation." },
    ],
    overallAssessment: "Needs a few fixes.",
    recommendations: ["Add tests", "Update docs"],
    commentsCreated: 0,
    commentErrors: [],
    dryRun: true,
    pendingComments: [],
    ...overrides,
  };
}

function resetForm(): void {
  const { result, unmount } = renderHook(() => useReviewForm("pr"));
  act(() => {
    result.current.setInput("");
    result.current.setWrite(false);
    result.current.setStrategy(null);
    result.current.setRuns(null);
  });
  unmount();
}

function mockRun(summary: ReviewSummary = buildSummary()): void {
  vi.mocked(fetch)
    .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
    .mockResolvedValueOnce(sseResponse([sseFrames([{ type: "result", summary }])]));
}

function requestBody(): Record<string, unknown> {
  return JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
}

async function runReview(user: ReturnType<typeof userEvent.setup>, input = "7") {
  await user.type(screen.getByLabelText("Pull request"), input);
  await user.click(screen.getByRole("button", { name: "Run review" }));
}

describe("ReviewRunner", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(getReviewCacheStatus).mockReset();
    vi.mocked(getReviewCacheStatus).mockResolvedValue({ cached: false });
    resetForm();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects an empty field before calling the server", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ReviewRunner />);

    await user.click(screen.getByRole("button", { name: "Run review" }));

    expect(screen.getByText("Enter a PR URL or number.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["   ", "Enter a PR URL or number."],
    ["abc", "Enter a valid PR URL or a positive PR number."],
    ["0", "Enter a valid PR URL or a positive PR number."],
    ["1.5", "Enter a valid PR URL or a positive PR number."],
  ])("rejects %j before calling the server", async (input, message) => {
    const user = userEvent.setup();
    renderWithMantine(<ReviewRunner />);

    await user.type(screen.getByLabelText("Pull request"), input);
    await user.click(screen.getByRole("button", { name: "Run review" }));

    expect(screen.getByText("Review failed")).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("runs a review for a PR number and renders the result", async () => {
    const user = userEvent.setup();
    mockRun();
    renderWithMantine(<ReviewRunner />);

    await runReview(user, " 7 ");

    expect(await screen.findByText("Review result")).toBeInTheDocument();
    expect(requestBody()).toEqual({ pr: 7, write: false });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/review/stream");
  });

  it("runs a review for a PR URL", async () => {
    const user = userEvent.setup();
    mockRun();
    renderWithMantine(<ReviewRunner />);

    await runReview(user, "https://github.com/acme/widgets/pull/7");

    await screen.findByText("Review result");
    expect(requestBody()).toEqual({
      prUrl: "https://github.com/acme/widgets/pull/7",
      write: false,
    });
  });

  it("includes write mode, strategy and run count when set", async () => {
    const user = userEvent.setup();
    mockRun();
    renderWithMantine(<ReviewRunner />);

    await user.click(screen.getByRole("switch", { name: /Post comments to the PR/ }));
    await user.click(screen.getByRole("combobox", { name: /Review strategy/ }));
    await user.click(await screen.findByRole("option", { name: "deep" }));
    await user.type(screen.getByLabelText("Review runs"), "3");
    await runReview(user);

    await screen.findByText("Review result");
    expect(requestBody()).toEqual({ pr: 7, write: true, strategy: "deep", runs: 3 });
  });

  it("shows the server error when the run cannot be created", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "PR not found" }, 404));
    renderWithMantine(<ReviewRunner />);

    await runReview(user);

    expect(await screen.findByText("PR not found")).toBeInTheDocument();
  });

  it("locks the form while running and lets the user stop watching", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
      .mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("Aborted"), { name: "AbortError" }))
            );
          })
      );
    renderWithMantine(<ReviewRunner />);

    await runReview(user);

    const stop = await screen.findByRole("button", { name: "Stop watching" });
    expect(screen.getByLabelText("Pull request")).toBeDisabled();
    expect(screen.getByLabelText("Review runs")).toBeDisabled();

    await user.click(stop);

    await waitFor(() => expect(screen.getByLabelText("Pull request")).toBeEnabled());
  });

  describe("cached review lookup", () => {
    it("offers a re-review switch when a cached review exists and sends reReview", async () => {
      const user = userEvent.setup();
      vi.mocked(getReviewCacheStatus).mockResolvedValue({
        cached: true,
        lastReviewedAt: "2026-01-02T03:04:05.000Z",
        cachedFiles: 12,
      });
      mockRun();
      renderWithMantine(<ReviewRunner />);

      await user.type(screen.getByLabelText("Pull request"), "7");
      const reReview = await screen.findByRole("switch", { name: /Re-review/ });
      expect(screen.getByText(/A cached review exists from .* \(12 files\)\./)).toBeInTheDocument();
      expect(getReviewCacheStatus).toHaveBeenCalledWith({ data: { pr: 7 } });

      await user.click(reReview);
      await user.click(screen.getByRole("button", { name: "Run review" }));

      await screen.findByText("Review result");
      expect(requestBody()).toEqual({ pr: 7, write: false, reReview: true });
    });

    it("describes a cache without a timestamp or file count", async () => {
      const user = userEvent.setup();
      vi.mocked(getReviewCacheStatus).mockResolvedValue({ cached: true });
      renderWithMantine(<ReviewRunner />);

      await user.type(screen.getByLabelText("Pull request"), "7");

      expect(await screen.findByText(/^A cached review exists\. Turn on/)).toBeInTheDocument();
    });

    it("looks up PR URLs and ignores uncached or invalid targets", async () => {
      const user = userEvent.setup();
      renderWithMantine(<ReviewRunner />);

      await user.type(screen.getByLabelText("Pull request"), "nope");
      await user.clear(screen.getByLabelText("Pull request"));
      await user.type(screen.getByLabelText("Pull request"), "https://github.com/acme/w/pull/9");

      await waitFor(() =>
        expect(getReviewCacheStatus).toHaveBeenLastCalledWith({
          data: { prUrl: "https://github.com/acme/w/pull/9" },
        })
      );
      expect(screen.queryByRole("switch", { name: /Re-review/ })).not.toBeInTheDocument();
    });

    it("does not send reReview when the cache disappears after enabling it", async () => {
      const user = userEvent.setup();
      vi.mocked(getReviewCacheStatus).mockResolvedValueOnce({ cached: true });
      mockRun();
      renderWithMantine(<ReviewRunner />);

      await user.type(screen.getByLabelText("Pull request"), "7");
      await user.click(await screen.findByRole("switch", { name: /Re-review/ }));
      await user.type(screen.getByLabelText("Pull request"), "1");
      await waitFor(() =>
        expect(screen.queryByRole("switch", { name: /Re-review/ })).not.toBeInTheDocument()
      );

      await user.click(screen.getByRole("button", { name: "Run review" }));

      await screen.findByText("Review result");
      expect(requestBody()).toEqual({ pr: 71, write: false });
    });

    it("keeps working when the cache lookup fails", async () => {
      const user = userEvent.setup();
      vi.mocked(getReviewCacheStatus).mockRejectedValue(new Error("boom"));
      mockRun();
      renderWithMantine(<ReviewRunner />);

      await runReview(user);

      expect(await screen.findByText("Review result")).toBeInTheDocument();
    });
  });
});

describe("ReviewResult interactions", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows stats, critical alert, assessment and recommendations", () => {
    renderWithMantine(<ReviewResult summary={buildSummary()} target={{ pr: 7 }} />);

    expect(screen.getByText("PR #7 · Add widget")).toBeInTheDocument();
    expect(screen.getByText("dry-run")).toBeInTheDocument();
    expect(screen.getByText("1 critical finding(s)")).toBeInTheDocument();
    expect(screen.getByText("+20 / -4")).toBeInTheDocument();
    expect(screen.getByText("Needs a few fixes.")).toBeInTheDocument();
    expect(screen.getByText("• Add tests")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open PR" })).toHaveAttribute(
      "href",
      "https://github.com/acme/widgets/pull/7"
    );
    expect(screen.getByText("Suggestion: Use <= instead of <.")).toBeInTheDocument();
    expect(screen.getByText("pre-existing")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts:10")).toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
  });

  it("hides optional sections when there is nothing to show", () => {
    renderWithMantine(
      <ReviewResult
        summary={buildSummary({
          findings: [],
          crossFileFindings: [],
          overallAssessment: "",
          recommendations: [],
          dryRun: false,
        })}
        target={null}
      />
    );

    expect(screen.queryByText("dry-run")).not.toBeInTheDocument();
    expect(screen.queryByText(/critical finding/)).not.toBeInTheDocument();
    expect(screen.queryByText("Overall assessment")).not.toBeInTheDocument();
    expect(screen.queryByText("Recommendations")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
    expect(screen.queryByText("File findings (0)")).not.toBeInTheDocument();
  });

  it("filters findings by severity", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ReviewResult summary={buildSummary()} target={{ pr: 7 }} />);
    expect(screen.getByText("Showing 3 of 3 findings")).toBeInTheDocument();

    await user.click(screen.getByPlaceholderText("All severities"));
    await user.click(await screen.findByRole("option", { name: "high" }));

    expect(screen.getByText("Showing 1 of 3 findings")).toBeInTheDocument();
    expect(screen.getByText("Layering violation.")).toBeInTheDocument();
    expect(screen.queryByText("Off-by-one error.")).not.toBeInTheDocument();
    expect(screen.queryByText(/^File findings \(/)).not.toBeInTheDocument();
  });

  it("copies a markdown report", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ReviewResult summary={buildSummary()} target={{ pr: 7 }} />);

    await user.click(screen.getByRole("button", { name: "Copy report" }));

    expect(await navigator.clipboard.readText()).toBe(
      [
        "# Review: PR #7 — Add widget",
        "",
        "octocat · feature → main",
        "URL: https://github.com/acme/widgets/pull/7",
        "Mode: dry-run",
        "",
        "Files reviewed: 3 · skipped: 1 · comments: 0",
        "",
        "## Findings (3)",
        "- [critical/bug] src/a.ts:10 Off-by-one error.",
        "  - Suggestion: Use <= instead of <.",
        "- [low/style] src/b.ts Prefer const.",
        "- [high/design] Layering violation.",
        "",
        "## Overall assessment",
        "Needs a few fixes.",
        "",
        "## Recommendations",
        "- Add tests",
        "- Update docs",
      ].join("\n")
    );
  });

  it("copies a minimal report in write mode with no assessment or recommendations", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ReviewResult
        summary={buildSummary({
          dryRun: false,
          findings: [],
          crossFileFindings: [],
          overallAssessment: "",
          recommendations: [],
        })}
        target={null}
      />
    );

    await user.click(screen.getByRole("button", { name: "Copy report" }));

    const copied = await navigator.clipboard.readText();
    expect(copied).toContain("Mode: write");
    expect(copied).toContain("## Findings (0)");
    expect(copied).not.toContain("## Overall assessment");
    expect(copied).not.toContain("## Recommendations");
  });

  it("lists comment errors from posting during the run", () => {
    renderWithMantine(
      <ReviewResult
        summary={buildSummary({ dryRun: false, commentErrors: ["src/a.ts: rejected"] })}
        target={{ pr: 7 }}
      />
    );

    expect(screen.getByText("1 comment(s) failed to post")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts: rejected")).toBeInTheDocument();
  });

  describe("posting planned comments", () => {
    const summary = buildSummary({
      pendingComments: [
        {
          path: "src/a.ts",
          line: 10,
          body: "### Bug\n\n**Issue**: Off-by-one error.\n",
          fingerprint: "fp-a",
          posted: false,
        },
        { body: "Summary of the review", fingerprint: "fp-summary", posted: false },
      ],
    });

    it("posts a single finding's comment from its inline button", async () => {
      const user = userEvent.setup();
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({
          commentsCreated: 1,
          commentsSkipped: 0,
          commentErrors: [],
          postedFingerprints: ["fp-a"],
        })
      );
      renderWithMantine(<ReviewResult summary={summary} target={{ pr: 7 }} />);

      await user.click(screen.getByRole("button", { name: "Post src/a.ts:10" }));

      expect(await screen.findByRole("checkbox", { name: "src/a.ts:10 posted" })).toBeChecked();
      expect(screen.getByText("posted")).toBeInTheDocument();
      expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toMatchObject({
        kind: "pr",
        pr: 7,
        comments: [{ fingerprint: "fp-a" }],
      });
    });

    it("posts the selected batch, including the unassigned summary comment", async () => {
      const user = userEvent.setup();
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({
          commentsCreated: 2,
          commentsSkipped: 0,
          commentErrors: [],
          postedFingerprints: ["fp-a", "fp-summary"],
        })
      );
      renderWithMantine(<ReviewResult summary={summary} target={{ pr: 7 }} />);

      expect(screen.getByText("Summary of the review")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Post 2 comments" }));

      expect(await screen.findByText("Comments posted")).toBeInTheDocument();
      expect(screen.getByText(/2 comments posted\./)).toBeInTheDocument();
      expect(screen.getByText("All planned comments have been posted.")).toBeInTheDocument();
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.comments.map((comment: PendingCommentView) => comment.fingerprint)).toEqual([
        "fp-a",
        "fp-summary",
      ]);
    });

    it("lets the user deselect a finding and clear or re-select everything", async () => {
      const user = userEvent.setup();
      renderWithMantine(<ReviewResult summary={summary} target={{ pr: 7 }} />);
      const findingBox = screen.getByRole("checkbox", { name: "Select src/a.ts:10" });

      expect(findingBox).toBeChecked();
      await user.click(findingBox);
      expect(findingBox).not.toBeChecked();
      expect(screen.getByRole("button", { name: "Post 1 comment" })).toBeEnabled();

      await user.click(screen.getByRole("button", { name: "Clear" }));
      expect(screen.getByRole("button", { name: "Post 0 comments" })).toBeDisabled();

      await user.click(screen.getByRole("button", { name: "Select all" }));
      expect(screen.getByRole("button", { name: "Post 2 comments" })).toBeEnabled();
    });

    it("shows a batch error and a per-finding error", async () => {
      const user = userEvent.setup();
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ error: "Line not in diff" }, 422))
        .mockResolvedValueOnce(jsonResponse({ error: "Token expired" }, 401));
      renderWithMantine(<ReviewResult summary={summary} target={{ pr: 7 }} />);

      await user.click(screen.getByRole("button", { name: "Post src/a.ts:10" }));
      const finding = await screen.findByText("Line not in diff");
      expect(finding).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Post 2 comments" }));
      expect(await screen.findByText("Token expired")).toBeInTheDocument();
    });

    it("disables posting without a resolved target", () => {
      renderWithMantine(<ReviewResult summary={summary} target={null} />);

      expect(screen.getByRole("button", { name: "Post src/a.ts:10" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Post 2 comments" })).toBeDisabled();
    });

    it("only offers posting for the matching finding", () => {
      renderWithMantine(<ReviewResult summary={summary} target={{ pr: 7 }} />);

      // One inline control for the matched finding; the pathless summary comment is not one.
      const inlinePostButtons = screen.getAllByRole("button", { name: /^Post src\// });
      expect(inlinePostButtons).toHaveLength(1);
      expect(inlinePostButtons[0]).toHaveAccessibleName("Post src/a.ts:10");
    });
  });
});
