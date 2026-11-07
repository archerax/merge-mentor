import { keepPreviousData } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { LiveStatsResult } from "../server/stats.functions.js";

const getLiveStats = vi.fn<(args: { data: { days: number } }) => Promise<LiveStatsResult>>();
vi.mock("../server/stats.functions.js", () => ({ getLiveStats }));

const { statsQuery } = await import("./stats.js");
const { createTestQueryClient } = await import("../test/renderWithQuery.test-helper.js");

describe("statsQuery", () => {
  it("loads the stats for the chosen window, keyed by it", async () => {
    getLiveStats.mockResolvedValue({ ok: false, error: "No token" });

    await expect(createTestQueryClient().fetchQuery(statsQuery(7))).resolves.toEqual({
      ok: false,
      error: "No token",
    });
    expect(getLiveStats).toHaveBeenCalledWith({ data: { days: 7 } });
    expect(statsQuery(7).queryKey).not.toEqual(statsQuery(30).queryKey);
  });

  it("does not rescan the platform when the tab regains focus", () => {
    expect(statsQuery(7).refetchOnWindowFocus).toBe(false);
  });

  it("keeps the previous window's data on screen while another window loads", () => {
    expect(statsQuery(90).placeholderData).toBe(keepPreviousData);
  });
});
