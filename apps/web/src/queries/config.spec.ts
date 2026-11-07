import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigEdit, ConfigSaveResult, ConfigView } from "../server/config.types.js";

const getConfig = vi.fn<() => Promise<ConfigView>>();
const saveConfig =
  vi.fn<(args: { data: { edits: readonly ConfigEdit[] } }) => Promise<ConfigSaveResult>>();
vi.mock("../server/config.functions.js", () => ({ getConfig, saveConfig }));

const { configQuery, saveConfigMutation } = await import("./config.js");
const { createTestQueryClient } = await import("../test/renderWithQuery.test-helper.js");

const before: ConfigView = { sections: [], warnings: ["Token missing"], error: null };
const after: ConfigView = { sections: [], warnings: [], error: null };
const edits: readonly ConfigEdit[] = [{ envVar: "MM_PLATFORM", value: "github" }];
const otherKey = ["stats", "detail", 30] as const;

function seeded() {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(configQuery.queryKey, before);
  queryClient.setQueryData(otherKey, { ok: true });
  return queryClient;
}

describe("configQuery", () => {
  beforeEach(() => {
    getConfig.mockReset();
  });

  it("loads the configuration from the server function", async () => {
    getConfig.mockResolvedValue(before);
    await expect(createTestQueryClient().fetchQuery(configQuery)).resolves.toEqual(before);
  });
});

describe("saveConfigMutation", () => {
  beforeEach(() => {
    saveConfig.mockReset();
  });

  it("caches the saved configuration and marks every query stale", async () => {
    saveConfig.mockResolvedValue({ ok: true, view: after, errors: [] });
    const queryClient = seeded();

    await new MutationObserver(queryClient, saveConfigMutation).mutate(edits);

    expect(saveConfig).toHaveBeenCalledWith({ data: { edits } });
    expect(queryClient.getQueryData(configQuery.queryKey)).toEqual(after);
    expect(queryClient.getQueryState(configQuery.queryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(true);
  });

  it("keeps the cached configuration when values are rejected", async () => {
    const errors = [{ envVar: "MM_PLATFORM", message: "Unknown platform" }];
    saveConfig.mockResolvedValue({ ok: false, view: after, errors });
    const queryClient = seeded();
    const observer = new MutationObserver(queryClient, saveConfigMutation);

    await observer.mutate(edits);

    expect(observer.getCurrentResult().data?.errors).toEqual(errors);
    expect(queryClient.getQueryData(configQuery.queryKey)).toEqual(before);
    expect(queryClient.getQueryState(configQuery.queryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  it("keeps the error when the save request fails", async () => {
    saveConfig.mockRejectedValue(new Error("offline"));
    const queryClient = seeded();
    const observer = new MutationObserver(queryClient, saveConfigMutation);

    await expect(observer.mutate(edits)).rejects.toThrow("offline");

    expect(observer.getCurrentResult().error?.message).toBe("offline");
    expect(queryClient.getQueryData(configQuery.queryKey)).toEqual(before);
    expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });
});
