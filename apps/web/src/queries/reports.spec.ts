import type { ReportDocument } from "@merge-mentor/shared/reports/index.js";
import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReportListItem } from "../server/reports.server.js";

const getReports = vi.fn<() => Promise<ReportListItem[]>>();
const getReport = vi.fn<(args: { data: { name: string } }) => Promise<unknown>>();
const deletePrdReport = vi.fn<(args: { data: { runId: string } }) => Promise<{ deleted: true }>>();
vi.mock("../server/reports.functions.js", () => ({ getReports, getReport, deletePrdReport }));

const { deletePrdRunMutation, reportQuery, reportsQuery, selectedReportName } =
  await import("./reports.js");
const { createTestQueryClient } = await import("../test/renderWithQuery.test-helper.js");

function item(name: string, prdRunId?: string): ReportListItem {
  const base: ReportListItem = {
    name,
    title: name,
    kind: prdRunId ? "prd" : "review",
    size: 10,
    modifiedAt: "2026-11-01T00:00:00.000Z",
  };
  return prdRunId ? { ...base, prdRunId } : base;
}

const review = item("review-1.md");
const prdReview = item("prd-run-1-review-report.md", "run-1");
const prdBreakdown = item("prd-run-1-breakdown.md", "run-1");
const otherPrd = item("prd-run-2-review-report.md", "run-2");
const list: readonly ReportListItem[] = [review, prdReview, prdBreakdown, otherPrd];

describe("reportsQuery and reportQuery", () => {
  beforeEach(() => {
    getReports.mockReset();
    getReport.mockReset();
  });

  it("loads the report list from the server function", async () => {
    getReports.mockResolvedValue([review]);
    await expect(createTestQueryClient().fetchQuery(reportsQuery)).resolves.toEqual([review]);
  });

  it("loads one report by name under its own key", async () => {
    getReport.mockResolvedValue({ name: "a.md", content: "# A" });
    const queryClient = createTestQueryClient();
    await expect(queryClient.fetchQuery(reportQuery("a.md"))).resolves.toEqual({
      name: "a.md",
      content: "# A",
    });
    expect(getReport).toHaveBeenCalledWith({ data: { name: "a.md" } });
    expect(reportQuery("a.md").queryKey).not.toEqual(reportQuery("b.md").queryKey);
  });
});

describe("selectedReportName", () => {
  it("prefers the report named in the URL", () => {
    expect(selectedReportName(list, "prd-run-1-breakdown.md", null)).toBe("prd-run-1-breakdown.md");
  });

  it("falls back to the newest report when the URL names none or an unknown one", () => {
    expect(selectedReportName(list, undefined, null)).toBe("review-1.md");
    expect(selectedReportName(list, "gone.md", null)).toBe("review-1.md");
  });

  it("is null when there are no reports", () => {
    expect(selectedReportName([], "gone.md", null)).toBeNull();
  });

  it("keeps a remembered pick made under the same URL", () => {
    const pick = { search: undefined, name: otherPrd.name };
    expect(selectedReportName(list, undefined, pick)).toBe(otherPrd.name);
  });

  it("ignores a pick made under another URL or whose report is gone", () => {
    expect(
      selectedReportName(list, "review-1.md", { search: undefined, name: otherPrd.name })
    ).toBe("review-1.md");
    expect(selectedReportName(list, undefined, { search: undefined, name: "gone.md" })).toBe(
      "review-1.md"
    );
  });
});

/** A promise the test settles by hand, to look at the cache while a request is in flight. */
function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve: (value) => resolve?.(value) };
}

function seeded() {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(reportsQuery.queryKey, list);
  const detail: ReportDocument = { ...prdReview, content: "# PRD" };
  queryClient.setQueryData(reportQuery(prdReview.name).queryKey, detail);
  const kept: ReportDocument = { ...review, content: "# Review" };
  queryClient.setQueryData(reportQuery(review.name).queryKey, kept);
  return queryClient;
}

describe("deletePrdRunMutation", () => {
  beforeEach(() => {
    deletePrdReport.mockReset();
  });

  it("removes the run's reports from the list before the server answers", async () => {
    const server = deferred<{ deleted: true }>();
    deletePrdReport.mockReturnValue(server.promise);
    const queryClient = seeded();

    const pending = new MutationObserver(queryClient, deletePrdRunMutation).mutate("run-1");
    await vi.waitFor(() => expect(deletePrdReport).toHaveBeenCalled());

    expect(deletePrdReport).toHaveBeenCalledWith({ data: { runId: "run-1" } });
    expect(queryClient.getQueryData(reportsQuery.queryKey)).toEqual([review, otherPrd]);
    server.resolve({ deleted: true });
    await pending;
  });

  it("forgets the deleted reports' contents and marks the list stale on success", async () => {
    deletePrdReport.mockResolvedValue({ deleted: true });
    const queryClient = seeded();

    await new MutationObserver(queryClient, deletePrdRunMutation).mutate("run-1");

    expect(queryClient.getQueryData(reportsQuery.queryKey)).toEqual([review, otherPrd]);
    expect(queryClient.getQueryData(reportQuery(prdReview.name).queryKey)).toBeUndefined();
    expect(queryClient.getQueryData(reportQuery(review.name).queryKey)).toBeDefined();
    expect(queryClient.getQueryState(reportsQuery.queryKey)?.isInvalidated).toBe(true);
  });

  it("puts the list back and keeps the error when the server refuses", async () => {
    deletePrdReport.mockRejectedValue(new Error("Invalid run id"));
    const queryClient = seeded();
    const observer = new MutationObserver(queryClient, deletePrdRunMutation);

    await expect(observer.mutate("run-1")).rejects.toThrow("Invalid run id");

    expect(queryClient.getQueryData(reportsQuery.queryKey)).toEqual(list);
    expect(queryClient.getQueryData(reportQuery(prdReview.name).queryKey)).toBeDefined();
    expect(observer.getCurrentResult().error?.message).toBe("Invalid run id");
    expect(queryClient.getQueryState(reportsQuery.queryKey)?.isInvalidated).toBe(true);
  });

  it("copes with no cached list", async () => {
    deletePrdReport.mockResolvedValue({ deleted: true });
    const queryClient = createTestQueryClient();
    await new MutationObserver(queryClient, deletePrdRunMutation).mutate("run-1");
    expect(queryClient.getQueryData(reportsQuery.queryKey)).toBeUndefined();
  });
});
