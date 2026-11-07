import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiStatus } from "../server/aiStatus.types.js";

const getAiStatus = vi.fn<(args: { data: { force: boolean } }) => Promise<AiStatus>>();
vi.mock("../server/aiStatus.functions.js", () => ({ getAiStatus }));

const { aiStatusQuery, refreshAiStatusMutation } = await import("./aiStatus.js");
const { createTestQueryClient } = await import("../test/renderWithQuery.test-helper.js");

describe("aiStatusQuery", () => {
  beforeEach(() => {
    getAiStatus.mockReset();
  });

  it("loads the status without forcing a re-check", async () => {
    getAiStatus.mockResolvedValue({ kind: "other-provider", provider: "opencode-sdk" });
    const status = await createTestQueryClient().fetchQuery(aiStatusQuery);
    expect(status).toEqual({ kind: "other-provider", provider: "opencode-sdk" });
    expect(getAiStatus).toHaveBeenCalledWith({ data: { force: false } });
  });

  it("reports a non-Error failure as text", async () => {
    getAiStatus.mockImplementation(async () => {
      throw "plain string";
    });
    const status = await createTestQueryClient().fetchQuery(aiStatusQuery);
    expect(status).toEqual({ kind: "copilot-error", message: "plain string" });
  });

  it("turns a failed call into a copilot-error status instead of a query error", async () => {
    getAiStatus.mockImplementation(async () => {
      throw new Error("server down");
    });
    const queryClient = createTestQueryClient();
    const status = await queryClient.fetchQuery(aiStatusQuery);
    expect(status).toEqual({ kind: "copilot-error", message: "server down" });
    expect(queryClient.getQueryState(aiStatusQuery.queryKey)?.status).toBe("success");
  });
});

describe("refreshAiStatusMutation", () => {
  beforeEach(() => {
    getAiStatus.mockReset();
  });

  it("forces a re-check and replaces the cached status", async () => {
    const queryClient = createTestQueryClient();
    const stale: AiStatus = { kind: "copilot-error", message: "old" };
    queryClient.setQueryData(aiStatusQuery.queryKey, stale);
    getAiStatus.mockResolvedValue({ kind: "byok", endpoint: "https://e", hasApiKey: true });

    await new MutationObserver(queryClient, refreshAiStatusMutation).mutate();

    expect(getAiStatus).toHaveBeenCalledWith({ data: { force: true } });
    expect(queryClient.getQueryData(aiStatusQuery.queryKey)).toEqual({
      kind: "byok",
      endpoint: "https://e",
      hasApiKey: true,
    });
  });

  it("is not overwritten by an initial fetch that was still in flight", async () => {
    const queryClient = createTestQueryClient();
    const initialCall: { finish?: (status: AiStatus) => void } = {};
    getAiStatus.mockImplementationOnce(
      () =>
        new Promise<AiStatus>((resolve) => {
          initialCall.finish = resolve;
        })
    );
    const initial = queryClient.fetchQuery(aiStatusQuery).catch(() => null);
    getAiStatus.mockResolvedValueOnce({ kind: "other-provider", provider: "forced" });

    await new MutationObserver(queryClient, refreshAiStatusMutation).mutate();
    initialCall.finish?.({ kind: "copilot-error", message: "late" });
    await initial;

    expect(queryClient.getQueryData(aiStatusQuery.queryKey)).toEqual({
      kind: "other-provider",
      provider: "forced",
    });
  });

  it("stores a copilot-error status when the re-check fails", async () => {
    const queryClient = createTestQueryClient();
    getAiStatus.mockImplementation(async () => {
      throw new Error("boom");
    });
    await new MutationObserver(queryClient, refreshAiStatusMutation).mutate();
    expect(queryClient.getQueryData(aiStatusQuery.queryKey)).toEqual({
      kind: "copilot-error",
      message: "boom",
    });
  });
});
