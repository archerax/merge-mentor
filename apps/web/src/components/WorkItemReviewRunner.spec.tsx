// @vitest-environment jsdom
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PBIReviewSummary,
  PendingCommentView,
  ProjectReviewSummary,
} from "../server/review.types.js";
import { useReviewForm } from "../stores/reviewForms.js";
import { renderWithMantine } from "../test/renderWithMantine.js";
import { jsonResponse, sseFrames, sseResponse } from "../test/sse.js";
import {
  PBIReviewResult,
  ProjectReviewResult,
  WorkItemReviewRunner,
} from "./WorkItemReviewRunner.js";

const pendingComment: PendingCommentView = {
  body: "Planned PBI comment",
  fingerprint: "fp-1",
  posted: false,
};

function pbiSummary(overrides: Partial<PBIReviewSummary> = {}): PBIReviewSummary {
  return {
    id: "PBI-55",
    title: "Add login",
    overallAssessment: "Well specified.",
    suggestions: ["Add acceptance criteria", "Split the story"],
    dryRun: true,
    pendingComments: [],
    ...overrides,
  };
}

function projectSummary(overrides: Partial<ProjectReviewSummary> = {}): ProjectReviewSummary {
  return {
    id: "PLAN-1",
    title: "Q3 plan",
    completenessAssessment: "Mostly complete.",
    dependencyRisks: "Service X blocks Y.",
    acceptanceCriteriaAlignment: "Aligned.",
    estimationConsistency: "",
    overallAssessment: "Healthy plan.",
    confidence: "high",
    findings: [
      {
        workItemId: "12",
        dimension: "dependency",
        severity: "high",
        issue: "Circular dependency.",
        recommendation: "Break the cycle.",
      },
      {
        workItemId: "",
        dimension: "custom_dimension",
        severity: "unknown-severity",
        issue: "Unlabelled finding.",
        recommendation: "",
      },
    ],
    suggestions: ["Re-sequence the work"],
    dryRun: false,
    pendingComments: [],
    ...overrides,
  };
}

function resetForms(): void {
  for (const key of ["pr", "pbi", "project"] as const) {
    const { result, unmount } = renderHook(() => useReviewForm(key));
    act(() => {
      result.current.setInput("");
      result.current.setWrite(false);
    });
    unmount();
  }
}

function renderRunner(overrides: Partial<Parameters<typeof WorkItemReviewRunner>[0]> = {}) {
  return renderWithMantine(
    <WorkItemReviewRunner<PBIReviewSummary>
      endpoint="/api/pbi/stream"
      kind="pbi"
      inputLabel="Work item"
      placeholder="PBI-55"
      writeLabel="Post comments"
      writeDescription="Off runs a dry-run."
      actionLabel="Run PBI review"
      renderResult={(summary) => <PBIReviewResult summary={summary} />}
      {...overrides}
    />
  );
}

function streamResponses(summary: PBIReviewSummary): void {
  vi.mocked(fetch)
    .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
    .mockResolvedValueOnce(
      sseResponse([sseFrames([{ type: "result", summary }, { type: "done" }])])
    );
}

describe("WorkItemReviewRunner", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    resetForms();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the form with the provided labels", () => {
    renderRunner();

    expect(screen.getByLabelText("Work item")).toHaveAttribute("placeholder", "PBI-55");
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(screen.getByText("Off runs a dry-run.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run PBI review" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Stop watching" })).not.toBeInTheDocument();
  });

  it("asks for a work item before running", async () => {
    const user = userEvent.setup();
    renderRunner();

    await user.click(screen.getByRole("button", { name: "Run PBI review" }));

    expect(screen.getByText("Review failed")).toBeInTheDocument();
    expect(screen.getByText("Enter a work item URL or ID.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("treats whitespace-only input as empty", async () => {
    const user = userEvent.setup();
    renderRunner();

    await user.type(screen.getByLabelText("Work item"), "   ");
    await user.click(screen.getByRole("button", { name: "Run PBI review" }));

    expect(screen.getByText("Enter a work item URL or ID.")).toBeInTheDocument();
  });

  it("submits a bare ID as `id` and renders the result", async () => {
    const user = userEvent.setup();
    streamResponses(pbiSummary());
    renderRunner();

    await user.type(screen.getByLabelText("Work item"), "  PBI-55 ");
    await user.click(screen.getByRole("button", { name: "Run PBI review" }));

    expect(await screen.findByText("PBI review result")).toBeInTheDocument();
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({
      write: false,
      id: "PBI-55",
    });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/pbi/stream");
  });

  it("submits a URL as `url` with write mode when toggled", async () => {
    const user = userEvent.setup();
    streamResponses(pbiSummary());
    renderRunner();

    await user.type(
      screen.getByLabelText("Work item"),
      "https://dev.azure.com/org/project/_workitems/edit/12345"
    );
    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("button", { name: "Run PBI review" }));

    await screen.findByText("PBI review result");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({
      write: true,
      url: "https://dev.azure.com/org/project/_workitems/edit/12345",
    });
  });

  it("clears the form error on a successful run", async () => {
    const user = userEvent.setup();
    streamResponses(pbiSummary());
    renderRunner();

    await user.click(screen.getByRole("button", { name: "Run PBI review" }));
    expect(screen.getByText("Enter a work item URL or ID.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Work item"), "PBI-55");
    await user.click(screen.getByRole("button", { name: "Run PBI review" }));

    await screen.findByText("PBI review result");
    expect(screen.queryByText("Enter a work item URL or ID.")).not.toBeInTheDocument();
  });

  it("shows the server error when the run cannot be created", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "Work item not found" }, 404));
    renderRunner();

    await user.type(screen.getByLabelText("Work item"), "PBI-404");
    await user.click(screen.getByRole("button", { name: "Run PBI review" }));

    expect(await screen.findByText("Work item not found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run PBI review" })).toBeEnabled();
  });

  it("disables the form and offers to stop watching while running", async () => {
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
    renderRunner();

    await user.type(screen.getByLabelText("Work item"), "PBI-55");
    await user.click(screen.getByRole("button", { name: "Run PBI review" }));

    const stop = await screen.findByRole("button", { name: "Stop watching" });
    expect(screen.getByLabelText("Work item")).toBeDisabled();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run PBI review" })).toBeDisabled();

    await user.click(stop);

    await waitFor(() => expect(screen.getByLabelText("Work item")).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Stop watching" })).not.toBeInTheDocument();
  });

  it("reports the run id to the page", async () => {
    const user = userEvent.setup();
    const onRunCreated = vi.fn();
    streamResponses(pbiSummary());
    renderRunner({ onRunCreated });

    await user.type(screen.getByLabelText("Work item"), "PBI-55");
    await user.click(screen.getByRole("button", { name: "Run PBI review" }));

    await screen.findByText("PBI review result");
    expect(onRunCreated).toHaveBeenCalledWith("run-1");
  });

  it("offers to post planned comments after a dry-run", async () => {
    const user = userEvent.setup();
    streamResponses(pbiSummary({ pendingComments: [pendingComment] }));
    renderRunner();

    await user.type(screen.getByLabelText("Work item"), "PBI-55");
    await user.click(screen.getByRole("button", { name: "Run PBI review" }));

    expect(await screen.findByText("Post planned comments")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Post 1 comment" })).toBeEnabled();
  });

  it("does not offer posting when nothing was planned", async () => {
    const user = userEvent.setup();
    streamResponses(pbiSummary());
    renderRunner();

    await user.type(screen.getByLabelText("Work item"), "PBI-55");
    await user.click(screen.getByRole("button", { name: "Run PBI review" }));

    await screen.findByText("PBI review result");
    expect(screen.queryByText("Post planned comments")).not.toBeInTheDocument();
  });

  it("resumes a run from the URL and recovers its target for posting", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ manifest: { input: { id: "PBI-55", write: false } } }))
      .mockResolvedValueOnce(
        sseResponse([
          sseFrames([
            { type: "result", summary: pbiSummary({ pendingComments: [pendingComment] }) },
          ]),
        ])
      );
    renderRunner({ runId: "run-9" });

    expect(await screen.findByText("PBI review result")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Post 1 comment" })).toBeEnabled();
  });
});

describe("PBIReviewResult", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the assessment, suggestions and dry-run badge", () => {
    renderWithMantine(<PBIReviewResult summary={pbiSummary()} />);

    expect(screen.getByText("#PBI-55 · Add login")).toBeInTheDocument();
    expect(screen.getByText("dry-run")).toBeInTheDocument();
    expect(screen.getByText("Well specified.")).toBeInTheDocument();
    expect(screen.getByText("• Add acceptance criteria")).toBeInTheDocument();
    expect(screen.getByText("• Split the story")).toBeInTheDocument();
  });

  it("omits the title, badge and suggestions when absent", () => {
    renderWithMantine(
      <PBIReviewResult summary={pbiSummary({ title: "", dryRun: false, suggestions: [] })} />
    );

    expect(screen.getByText("#PBI-55")).toBeInTheDocument();
    expect(screen.queryByText("dry-run")).not.toBeInTheDocument();
    expect(screen.queryByText("Suggestions for improvement")).not.toBeInTheDocument();
  });

  it("copies a markdown report", async () => {
    const user = userEvent.setup();
    renderWithMantine(<PBIReviewResult summary={pbiSummary()} />);

    await user.click(screen.getByRole("button", { name: "Copy report" }));

    expect(await navigator.clipboard.readText()).toBe(
      [
        "# PBI review: #PBI-55 — Add login",
        "",
        "Mode: dry-run",
        "",
        "## Assessment",
        "Well specified.",
        "",
        "## Suggestions",
        "- Add acceptance criteria",
        "- Split the story",
      ].join("\n")
    );
  });

  it("copies a minimal report for an untitled write-mode review without suggestions", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PBIReviewResult summary={pbiSummary({ title: "", dryRun: false, suggestions: [] })} />
    );

    await user.click(screen.getByRole("button", { name: "Copy report" }));

    expect(await navigator.clipboard.readText()).toBe(
      ["# PBI review: #PBI-55", "", "Mode: write", "", "## Assessment", "Well specified."].join(
        "\n"
      )
    );
  });
});

describe("ProjectReviewResult", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the assessment blocks, skipping empty ones", () => {
    renderWithMantine(<ProjectReviewResult summary={projectSummary()} />);

    expect(screen.getByText("Project review result")).toBeInTheDocument();
    expect(screen.getByText("confidence: high")).toBeInTheDocument();
    expect(screen.getByText("Plan completeness & gaps")).toBeInTheDocument();
    expect(screen.getByText("Service X blocks Y.")).toBeInTheDocument();
    expect(screen.getByText("Acceptance criteria alignment")).toBeInTheDocument();
    expect(screen.queryByText("Estimation & scope consistency")).not.toBeInTheDocument();
    expect(screen.getByText("Healthy plan.")).toBeInTheDocument();
    expect(screen.queryByText("dry-run")).not.toBeInTheDocument();
  });

  it("renders findings with labelled dimensions and optional fields", () => {
    renderWithMantine(<ProjectReviewResult summary={projectSummary()} />);

    expect(screen.getByText("Findings (2)")).toBeInTheDocument();
    expect(screen.getByText("Dependency")).toBeInTheDocument();
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.getByText("Circular dependency.")).toBeInTheDocument();
    expect(screen.getByText("Recommendation: Break the cycle.")).toBeInTheDocument();
    expect(screen.getByText("custom_dimension")).toBeInTheDocument();
    expect(screen.getByText("Unlabelled finding.")).toBeInTheDocument();
    expect(screen.getAllByText(/^Recommendation:/)).toHaveLength(1);
  });

  it("omits findings, suggestions and confidence when absent", () => {
    renderWithMantine(
      <ProjectReviewResult
        summary={projectSummary({ findings: [], suggestions: [], confidence: "", dryRun: true })}
      />
    );

    expect(screen.queryByText(/^Findings/)).not.toBeInTheDocument();
    expect(screen.queryByText("Suggestions for improvement")).not.toBeInTheDocument();
    expect(screen.queryByText(/^confidence:/)).not.toBeInTheDocument();
    expect(screen.getByText("dry-run")).toBeInTheDocument();
  });

  it("copies a markdown report including findings", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ProjectReviewResult summary={projectSummary()} />);

    await user.click(screen.getByRole("button", { name: "Copy report" }));

    expect(await navigator.clipboard.readText()).toBe(
      [
        "# Project review: #PLAN-1 — Q3 plan",
        "",
        "Confidence: high · Mode: write",
        "",
        "## Plan completeness & gaps",
        "Mostly complete.",
        "",
        "## Dependency & sequencing risks",
        "Service X blocks Y.",
        "",
        "## Acceptance criteria alignment",
        "Aligned.",
        "",
        "## Estimation & scope consistency",
        "",
        "",
        "## Findings (2)",
        "- [high/dependency] #12 Circular dependency.",
        "  - Recommendation: Break the cycle.",
        "- [unknown-severity/custom_dimension] Unlabelled finding.",
        "",
        "## Overall assessment",
        "Healthy plan.",
        "",
        "## Suggestions",
        "- Re-sequence the work",
      ].join("\n")
    );
  });

  it("copies a report without findings or suggestions for an untitled dry-run", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ProjectReviewResult
        summary={projectSummary({ title: "", findings: [], suggestions: [], dryRun: true })}
      />
    );

    await user.click(screen.getByRole("button", { name: "Copy report" }));

    const copied = await navigator.clipboard.readText();
    expect(copied).toContain("# Project review: #PLAN-1\n");
    expect(copied).toContain("Mode: dry-run");
    expect(copied).not.toContain("## Findings");
    expect(copied).not.toContain("## Suggestions");
  });
});
