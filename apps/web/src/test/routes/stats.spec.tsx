// @vitest-environment jsdom
import type { LiveReviewStats } from "@merge-mentor/core/review/reviewStats.js";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithMantine } from "../renderWithMantine.js";
import { optionsOf, resetRouteState, routeIdOf, routeState } from "../routerMock.js";

vi.mock("@tanstack/react-router", async () => (await import("../routerMock.js")).routerMock);
vi.mock("../../server/stats.functions.js", () => ({ getLiveStats: vi.fn() }));

const { getLiveStats } = await import("../../server/stats.functions.js");
const { Route } = await import("../../routes/stats.js");
const StatsPage = optionsOf(Route).component;

const stats: LiveReviewStats = {
  platform: "github",
  project: "acme/widgets",
  prsScanned: 40,
  prsReviewed: 12,
  totalComments: 1234,
  inlineComments: 1000,
  generalComments: 234,
  prsFailed: 0,
  truncated: false,
  reviewedPullRequests: [
    { number: 7, title: "Add widget", state: "closed", inlineComments: 3, generalComments: 1 },
  ],
};

const validate = (search: Record<string, unknown>) => optionsOf(Route).validateSearch(search);

describe("stats route", () => {
  it("registers the /stats path", () => {
    expect(routeIdOf(Route)).toBe("/stats");
  });

  beforeEach(() => {
    resetRouteState();
    vi.mocked(getLiveStats).mockReset();
  });

  describe("validateSearch", () => {
    it.each([
      [{ days: 7 }, 7],
      [{ days: "30" }, 30],
      [{ days: "90" }, 90],
    ])("accepts a supported window %j", (search, days) => {
      expect(validate(search)).toEqual({ days });
    });

    it.each([[{}], [{ days: 14 }], [{ days: "abc" }]])("defaults to 30 days for %j", (search) => {
      expect(validate(search)).toEqual({ days: 30 });
    });
  });

  it("loads stats for the requested window", async () => {
    vi.mocked(getLiveStats).mockResolvedValue({ ok: true, stats } as never);

    const result = await optionsOf(Route).loader({ deps: { days: 7 } });

    expect(getLiveStats).toHaveBeenCalledWith({ data: { days: 7 } });
    expect(result).toEqual({ ok: true, stats });
  });

  it("derives the loader window from the search parameters", async () => {
    vi.mocked(getLiveStats).mockResolvedValue({ ok: true, stats } as never);

    const deps = optionsOf(Route).loaderDeps({ search: { days: 90 } });
    await optionsOf(Route).loader({ deps: deps as Record<string, unknown> });

    expect(deps).toEqual({ days: 90 });
    expect(getLiveStats).toHaveBeenCalledWith({ data: { days: 90 } });
  });

  it("renders the totals, hints and reviewed pull requests", () => {
    routeState.loaderData = { ok: true, stats };
    routeState.search = { days: 7 };
    renderWithMantine(<StatsPage />);

    expect(screen.getByText("acme/widgets")).toBeInTheDocument();
    expect(screen.getByText(/PRs from the last 7 days/)).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText((1234).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText("1000 inline, 234 general")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Add widget" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "#7" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "closed" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "3" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1" })).toBeInTheDocument();
    expect(screen.queryByText("PR limit reached")).not.toBeInTheDocument();
    expect(screen.queryByText("Some PRs could not be read")).not.toBeInTheDocument();
  });

  it("warns only about the PR limit when it was reached", () => {
    routeState.loaderData = {
      ok: true,
      stats: { ...stats, truncated: true, prsFailed: 0, reviewedPullRequests: [] },
    };
    routeState.search = { days: 7 };
    renderWithMantine(<StatsPage />);

    expect(screen.getByText("PR limit reached")).toBeInTheDocument();
    expect(screen.getByText(/Only the 40 most recent PRs were inspected/)).toBeInTheDocument();
    expect(screen.queryByText("Some PRs could not be read")).not.toBeInTheDocument();
  });

  it("warns only about unreadable PRs when some failed", () => {
    routeState.loaderData = {
      ok: true,
      stats: { ...stats, truncated: false, prsFailed: 3 },
    };
    routeState.search = { days: 7 };
    renderWithMantine(<StatsPage />);

    expect(screen.getByText("Some PRs could not be read")).toBeInTheDocument();
    expect(screen.getByText(/3 PR\(s\) were excluded/)).toBeInTheDocument();
    expect(screen.queryByText("PR limit reached")).not.toBeInTheDocument();
  });

  it("explains a failure to load stats and links to the configuration", () => {
    routeState.loaderData = { ok: false, error: "Bad credentials." };
    routeState.search = { days: 30 };
    renderWithMantine(<StatsPage />);

    expect(screen.getByText("Could not load live stats")).toBeInTheDocument();
    expect(screen.getByText(/Bad credentials\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "configuration" })).toHaveAttribute("href", "/config");
  });

  it("changes the window through the search parameters", async () => {
    const user = userEvent.setup();
    routeState.loaderData = { ok: true, stats };
    routeState.search = { days: 30 };
    renderWithMantine(<StatsPage />);

    expect(screen.getByRole("radio", { name: "30d" })).toBeChecked();

    await user.click(screen.getByText("7d"));

    expect(routeState.navigate).toHaveBeenCalledWith({ search: { days: 7 } });
  });
});
