// @vitest-environment jsdom
import type { PrdReviewReport } from "@merge-mentor/core/review/prd/prdReport.js";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRD_STREAM_ENDPOINT, type PrdReviewSummary } from "../server/prd.types.js";
import { renderWithMantine } from "../test/renderWithMantine.js";
import { jsonResponse, sseFrames, sseResponse } from "../test/sse.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string;
    search?: { report?: string };
    children?: ReactNode;
  }) => (
    <a href={`${to}?report=${search?.report ?? ""}`} {...rest}>
      {children}
    </a>
  ),
}));

const { PrdReviewResult, PrdReviewRunner } = await import("./PrdReviewRunner.js");

function buildSummary(overrides: Partial<PrdReviewReport> = {}): PrdReviewSummary {
  const report = {
    schemaVersion: 1,
    kind: "prd",
    runId: "run-1",
    createdAt: "2026-10-23T12:00:00.000Z",
    documentType: "prd",
    source: { fileName: "Checkout.docx", sizeBytes: 1000, sha256: "abc" },
    document: { title: "Checkout" },
    readiness: { verdict: "ready", summary: "Good." },
    complete: true,
    counts: { Blocker: 0, Major: 1, Minor: 2 },
    findings: [],
    notReviewed: [],
    includeImages: false,
    ...overrides,
  } as unknown as PrdReviewReport;
  return {
    prdRunId: report.runId,
    reportName: "prd-run-1-review-report.md",
    report,
    reportMarkdown: "# PRD review\n\nAll clear.",
  };
}

function docx(name = "Checkout.docx", size = 2048): File {
  return new File([new Uint8Array(size)], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input not found");
  return input;
}

function setup() {
  return userEvent.setup({ applyAccept: false });
}

describe("PrdReviewRunner interactions", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for a file before running", async () => {
    const user = setup();
    renderWithMantine(<PrdReviewRunner />);

    await user.click(screen.getByRole("button", { name: "Review document" }));

    expect(screen.getByText("The review could not be completed")).toBeInTheDocument();
    expect(screen.getByText("Choose a Word document (.docx) to review.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an older .doc file with guidance", async () => {
    const user = setup();
    renderWithMantine(<PrdReviewRunner />);

    await user.upload(fileInput(), docx("Legacy.doc"));
    await user.click(screen.getByRole("button", { name: "Review document" }));

    expect(screen.getByText(/older Word file \(\.doc\)/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clears the form error when a new file is picked", async () => {
    const user = setup();
    renderWithMantine(<PrdReviewRunner />);
    await user.click(screen.getByRole("button", { name: "Review document" }));
    expect(screen.getByText("Choose a Word document (.docx) to review.")).toBeInTheDocument();

    await user.upload(fileInput(), docx());

    expect(screen.queryByText("Choose a Word document (.docx) to review.")).not.toBeInTheDocument();
  });

  it("uploads the raw file with the chosen options and shows the result", async () => {
    const user = setup();
    const onRunCreated = vi.fn();
    const summary = buildSummary({ documentType: "frd" });
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
      .mockResolvedValueOnce(
        sseResponse([sseFrames([{ type: "result", summary }, { type: "done" }])])
      );
    renderWithMantine(<PrdReviewRunner onRunCreated={onRunCreated} />);

    const file = docx("My Spec & Notes.docx");
    await user.upload(fileInput(), file);
    await user.click(screen.getByRole("radio", { name: /Functional requirements \(FRD\)/ }));
    await user.click(screen.getByRole("checkbox", { name: /Include images/ }));
    await user.click(screen.getByRole("button", { name: "Review document" }));

    expect(await screen.findByText("FRD review result")).toBeInTheDocument();
    expect(onRunCreated).toHaveBeenCalledWith("run-1");

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(PRD_STREAM_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(file);
    expect(init?.headers).toEqual({
      "Content-Type": "application/octet-stream",
      "x-mm-document-type": "frd",
      "x-mm-include-images": "true",
      "x-mm-file-name": encodeURIComponent("My Spec & Notes.docx"),
    });
    expect(
      screen.getByText("Reviewing My Spec & Notes.docx as a FRD (with images).")
    ).toBeInTheDocument();
  });

  it("defaults to a PRD without images", async () => {
    const user = setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
      .mockResolvedValueOnce(
        sseResponse([sseFrames([{ type: "result", summary: buildSummary() }])])
      );
    renderWithMantine(<PrdReviewRunner />);

    await user.upload(fileInput(), docx());
    await user.click(screen.getByRole("button", { name: "Review document" }));

    await screen.findByText("PRD review result");
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({
      "x-mm-document-type": "prd",
      "x-mm-include-images": "false",
    });
    expect(screen.getByText("Reviewing Checkout.docx as a PRD.")).toBeInTheDocument();
  });

  it("shows the server error when the upload is rejected", async () => {
    const user = setup();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "Not a valid .docx file." }, 400));
    renderWithMantine(<PrdReviewRunner />);

    await user.upload(fileInput(), docx());
    await user.click(screen.getByRole("button", { name: "Review document" }));

    expect(await screen.findByText("Not a valid .docx file.")).toBeInTheDocument();
  });

  it("locks the form while running and lets the user stop watching", async () => {
    const user = setup();
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
    renderWithMantine(<PrdReviewRunner />);
    await user.upload(fileInput(), docx());

    await user.click(screen.getByRole("button", { name: "Review document" }));

    const stop = await screen.findByRole("button", { name: "Stop watching" });
    expect(screen.getByRole("checkbox", { name: /Include images/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Product requirements/ })).toBeDisabled();

    await user.click(stop);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop watching" })).toBeNull());
    expect(screen.getByRole("checkbox", { name: /Include images/ })).toBeEnabled();
  });

  it("resumes a run from the URL", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          manifest: {
            input: {
              documentType: "prd",
              includeImages: false,
              fileName: "Old.docx",
              sizeBytes: 1,
            },
          },
        })
      )
      .mockResolvedValueOnce(
        sseResponse([sseFrames([{ type: "result", summary: buildSummary() }])])
      );
    renderWithMantine(<PrdReviewRunner runId="run-1" />);

    expect(await screen.findByText("PRD review result")).toBeInTheDocument();
    expect(screen.getByText("Reviewing Old.docx as a PRD.")).toBeInTheDocument();
  });
});

describe("PrdReviewResult interactions", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("copies the Markdown report", async () => {
    const user = setup();
    renderWithMantine(<PrdReviewResult summary={buildSummary()} />);

    await user.click(screen.getByRole("button", { name: "Copy report" }));

    expect(await navigator.clipboard.readText()).toBe("# PRD review\n\nAll clear.");
  });

  it("uses singular wording for single-issue counts and omits the title when absent", () => {
    renderWithMantine(
      <PrdReviewResult
        summary={buildSummary({
          counts: { Blocker: 1, Major: 1, Minor: 1 },
          document: { title: "" } as PrdReviewReport["document"],
        })}
      />
    );

    expect(screen.getByText("1 blocker")).toBeInTheDocument();
    expect(screen.getByText("1 major issue")).toBeInTheDocument();
    expect(screen.getByText("1 minor issue")).toBeInTheDocument();
    expect(screen.getByText("Checkout.docx")).toBeInTheDocument();
  });

  it("warns when the AI provider retained session data", () => {
    renderWithMantine(
      <PrdReviewResult
        summary={buildSummary({ retainedSessionData: { count: 2 } } as Partial<PrdReviewReport>)}
      />
    );

    expect(screen.getByText("Some provider data may remain")).toBeInTheDocument();
    expect(screen.getByText(/for 2 request\(s\)/)).toBeInTheDocument();
  });
});
