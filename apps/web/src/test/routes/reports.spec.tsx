// @vitest-environment jsdom
import type { ReportDocument } from "@merge-mentor/shared/reports/index.js";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReportListItem } from "../../server/reports.server.js";
import { deferred } from "../deferred.js";
import { renderWithMantine } from "../renderWithMantine.js";
import { optionsOf, resetRouteState, routeState } from "../routerMock.js";

vi.mock("@tanstack/react-router", async () => (await import("../routerMock.js")).routerMock);
vi.mock("../../server/reports.functions.js", () => ({
  getReports: vi.fn(),
  getReport: vi.fn(),
  deletePrdReport: vi.fn(),
}));

const { getReports, getReport, deletePrdReport } =
  await import("../../server/reports.functions.js");
const { Route } = await import("../../routes/reports.js");
const ReportsPage = optionsOf(Route).component;

function item(overrides: Partial<ReportListItem> & { name: string }): ReportListItem {
  return {
    title: overrides.name,
    kind: "review",
    size: 512,
    modifiedAt: "2026-01-02T03:04:05.000Z",
    ...overrides,
  };
}

function document_(listItem: ReportListItem, content = `# ${listItem.title}`): ReportDocument {
  return { ...listItem, content };
}

const review = item({ name: "review-7.md", title: "PR 7 review", kind: "review", size: 2048 });
const pbi = item({ name: "pbi-1.md", title: "PBI 1", kind: "pbi" });
const prd = item({ name: "prd-1.md", title: "Checkout PRD", kind: "prd", prdRunId: "run-1" });

function loaded(reports: ReportListItem[], selected: ReportListItem | null = reports[0] ?? null) {
  routeState.loaderData = { reports, report: selected ? document_(selected) : null };
}

describe("reports route", () => {
  beforeEach(() => {
    resetRouteState();
    vi.mocked(getReports).mockReset();
    vi.mocked(getReport).mockReset();
    vi.mocked(deletePrdReport).mockReset();
  });

  describe("search and loader", () => {
    it.each([
      [{ report: "a.md" }, { report: "a.md" }],
      [{ report: "" }, { report: undefined }],
      [{ report: 3 }, { report: undefined }],
      [{}, { report: undefined }],
    ])("validates %j", (search, expected) => {
      expect(optionsOf(Route).validateSearch(search)).toEqual(expected);
    });

    it("keys the loader on the report search parameter", () => {
      expect(optionsOf(Route).loaderDeps({ search: { report: "a.md" } })).toEqual({
        report: "a.md",
      });
    });

    it("loads the requested report", async () => {
      vi.mocked(getReports).mockResolvedValue([review, pbi] as never);
      vi.mocked(getReport).mockResolvedValue(document_(pbi) as never);

      const result = await optionsOf(Route).loader({ deps: { report: "pbi-1.md" } });

      expect(getReport).toHaveBeenCalledWith({ data: { name: "pbi-1.md" } });
      expect(result).toEqual({ reports: [review, pbi], report: document_(pbi) });
    });

    it("falls back to the first report when the requested one is unknown", async () => {
      vi.mocked(getReports).mockResolvedValue([review, pbi] as never);
      vi.mocked(getReport).mockResolvedValue(document_(review) as never);

      await optionsOf(Route).loader({ deps: { report: "missing.md" } });

      expect(getReport).toHaveBeenCalledWith({ data: { name: "review-7.md" } });
    });

    it("does not load a report when there are none", async () => {
      vi.mocked(getReports).mockResolvedValue([] as never);

      const result = await optionsOf(Route).loader({ deps: {} });

      expect(getReport).not.toHaveBeenCalled();
      expect(result).toEqual({ reports: [], report: null });
    });
  });

  it("explains how to generate reports when there are none", () => {
    loaded([]);
    renderWithMantine(<ReportsPage />);

    expect(screen.getByText("No reports found")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search reports...")).not.toBeInTheDocument();
  });

  it("lists reports with kind and size and shows the selected one", () => {
    loaded([review, pbi]);
    renderWithMantine(<ReportsPage />);

    expect(screen.getByText("2 of 2 reports")).toBeInTheDocument();
    expect(screen.getByText("PR 7 review", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText(/· 2.0 KB/)).toBeInTheDocument();
    expect(screen.getByText(/· 512 B/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "PR 7 review" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete run" })).not.toBeInTheDocument();
  });

  it("asks the user to select a report when none is loaded", () => {
    loaded([review], null);
    renderWithMantine(<ReportsPage />);

    expect(screen.getByText("Select a report to view its contents.")).toBeInTheDocument();
  });

  it("filters the list by title, name and kind", async () => {
    const user = userEvent.setup();
    loaded([review, pbi, prd]);
    renderWithMantine(<ReportsPage />);
    const search = screen.getByPlaceholderText("Search reports...");

    await user.type(search, "checkout");
    expect(screen.getByText("1 of 3 reports")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "pbi-1");
    expect(screen.getByText("1 of 3 reports")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "review");
    expect(screen.getByText("1 of 3 reports")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "nothing-matches");
    expect(screen.getByText("No reports match your search.")).toBeInTheDocument();

    await user.clear(search);
    expect(screen.getByText("3 of 3 reports")).toBeInTheDocument();
  });

  it("loads another report when it is selected, showing a skeleton meanwhile", async () => {
    const user = userEvent.setup();
    const pending = deferred<ReportDocument>();
    vi.mocked(getReport).mockReturnValue(pending.promise as never);
    loaded([review, pbi]);
    renderWithMantine(<ReportsPage />);

    await user.click(screen.getByText("PBI 1", { selector: "p" }));

    expect(getReport).toHaveBeenCalledWith({ data: { name: "pbi-1.md" } });
    expect(document.querySelector(".mantine-Skeleton-root")).not.toBeNull();

    await act(async () => {
      pending.resolve(document_(pbi, "# Loaded PBI body"));
    });

    expect(await screen.findByRole("heading", { name: "Loaded PBI body" })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".mantine-Skeleton-root")).toBeNull());
  });

  describe("deleting a PRD review", () => {
    it("confirms before deleting and removes the report from the list", async () => {
      const user = userEvent.setup();
      vi.mocked(deletePrdReport).mockResolvedValue({ deleted: true } as never);
      loaded([review, prd], prd);
      renderWithMantine(<ReportsPage />);

      await user.click(screen.getByRole("button", { name: "Delete run" }));
      const dialog = await screen.findByRole("dialog", { name: "Delete this review?" });
      expect(within(dialog).getByText("Checkout PRD", { selector: "b" })).toBeInTheDocument();

      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      expect(deletePrdReport).toHaveBeenCalledWith({ data: { runId: "run-1" } });
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.getByText("1 of 1 reports")).toBeInTheDocument();
      expect(screen.getByText("Select a report to view its contents.")).toBeInTheDocument();
    });

    it("removes only the deleted run from the list", async () => {
      const user = userEvent.setup();
      vi.mocked(deletePrdReport).mockResolvedValue({ deleted: true } as never);
      loaded([review, prd], prd);
      renderWithMantine(<ReportsPage />);

      await user.click(screen.getByRole("button", { name: "Delete run" }));
      await user.click(await screen.findByRole("button", { name: "Delete" }));

      await waitFor(() => expect(deletePrdReport).toHaveBeenCalled());
      expect(screen.queryByText("Checkout PRD", { selector: "p" })).not.toBeInTheDocument();
      expect(screen.getByText("PR 7 review", { selector: "p" })).toBeInTheDocument();
    });

    it("can be cancelled without deleting", async () => {
      const user = userEvent.setup();
      loaded([review, prd], prd);
      renderWithMantine(<ReportsPage />);

      await user.click(screen.getByRole("button", { name: "Delete run" }));
      await user.click(await screen.findByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(deletePrdReport).not.toHaveBeenCalled();
      expect(screen.getByText("2 of 2 reports")).toBeInTheDocument();
    });

    it("shows why a deletion failed and stays open", async () => {
      const user = userEvent.setup();
      vi.mocked(deletePrdReport).mockRejectedValue(new Error("Run is locked"));
      loaded([review, prd], prd);
      renderWithMantine(<ReportsPage />);

      await user.click(screen.getByRole("button", { name: "Delete run" }));
      await user.click(await screen.findByRole("button", { name: "Delete" }));

      expect(await screen.findByText("Could not delete")).toBeInTheDocument();
      expect(screen.getByText("Run is locked")).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("2 of 2 reports")).toBeInTheDocument();
    });

    it("stringifies non-Error failures and clears the error on the next attempt", async () => {
      const user = userEvent.setup();
      vi.mocked(deletePrdReport).mockRejectedValueOnce("disk full");
      loaded([review, prd], prd);
      renderWithMantine(<ReportsPage />);

      await user.click(screen.getByRole("button", { name: "Delete run" }));
      await user.click(await screen.findByRole("button", { name: "Delete" }));
      expect(await screen.findByText("disk full")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await user.click(screen.getByRole("button", { name: "Delete run" }));

      expect(screen.queryByText("disk full")).not.toBeInTheDocument();
    });
  });
});
