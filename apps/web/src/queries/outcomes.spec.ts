import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OutcomesResult } from "../server/outcomes.functions.js";

const getOutcomes = vi.fn<() => Promise<OutcomesResult>>();
const startOutcomes = vi.fn<(args: { data: { refresh: boolean } }) => Promise<OutcomesResult>>();
vi.mock("../server/outcomes.functions.js", () => ({ getOutcomes, startOutcomes }));

const { outcomesQuery, outcomesRefetchInterval, startOutcomesMutation } =
  await import("./outcomes.js");
const { createTestQueryClient } = await import("../test/renderWithQuery.test-helper.js");

const idle: OutcomesResult = { ok: true, view: { scan: { running: false, done: 0, total: 0 } } };
const running: OutcomesResult = {
  ok: true,
  view: { scan: { running: true, done: 3, total: 10 } },
};

describe("outcomesRefetchInterval", () => {
  it("polls only while a scan is running", () => {
    expect(outcomesRefetchInterval(running)).toBe(2000);
    expect(outcomesRefetchInterval(idle)).toBe(false);
    expect(outcomesRefetchInterval({ ok: false, error: "no token" })).toBe(false);
    expect(outcomesRefetchInterval(undefined)).toBe(false);
  });
});

describe("outcomesQuery", () => {
  beforeEach(() => {
    getOutcomes.mockReset();
  });

  it("loads the saved outcomes from the server function", async () => {
    getOutcomes.mockResolvedValue(idle);
    await expect(createTestQueryClient().fetchQuery(outcomesQuery)).resolves.toEqual(idle);
  });
});

describe("startOutcomesMutation", () => {
  beforeEach(() => {
    startOutcomes.mockReset();
  });

  it("starts a scan, caches the running state and marks the outcomes stale", async () => {
    startOutcomes.mockResolvedValue(running);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(outcomesQuery.queryKey, idle);

    await new MutationObserver(queryClient, startOutcomesMutation).mutate(true);

    expect(startOutcomes).toHaveBeenCalledWith({ data: { refresh: true } });
    expect(queryClient.getQueryData(outcomesQuery.queryKey)).toEqual(running);
    expect(queryClient.getQueryState(outcomesQuery.queryKey)?.isInvalidated).toBe(true);
  });

  it("keeps the cached outcomes when the request fails", async () => {
    startOutcomes.mockRejectedValue(new Error("offline"));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(outcomesQuery.queryKey, idle);
    const observer = new MutationObserver(queryClient, startOutcomesMutation);

    await expect(observer.mutate(false)).rejects.toThrow("offline");

    expect(queryClient.getQueryData(outcomesQuery.queryKey)).toEqual(idle);
    expect(observer.getCurrentResult().error?.message).toBe("offline");
  });
});
