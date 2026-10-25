import { listUsageRecords } from "@merge-mentor/shared/reports/usageReport.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadUsageSummary } from "./usage.server.js";

vi.mock("@merge-mentor/shared/reports/usageReport.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@merge-mentor/shared/reports/usageReport.js")>()),
  listUsageRecords: vi.fn(),
}));
vi.mock("./env.server.js", () => ({ resolveTempPath: vi.fn(() => "/project/.mergementor") }));

describe("loadUsageSummary", () => {
  const now = new Date("2026-03-31T00:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.mocked(listUsageRecords).mockResolvedValue([
      {
        schemaVersion: 1,
        generatedAt: "2026-03-30T00:00:00.000Z",
        platform: "github",
        projectId: "o-r",
        prNumber: 1,
        prTitle: "PR",
        aiProvider: "copilot-sdk",
        tokenUsage: { inputTokens: 100, outputTokens: 20, model: "gpt-4.1" },
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("reads the reports directory under the resolved temp path for the window", async () => {
    const summary = await loadUsageSummary(7);

    const options = vi.mocked(listUsageRecords).mock.calls[0][0];
    expect(options?.reportsDir).toMatch(/\.mergementor[\\/]reports$/);
    expect(options?.since?.toISOString()).toBe("2026-03-24T00:00:00.000Z");
    expect(summary).toMatchObject({ runs: 1, inputTokens: 100, outputTokens: 20 });
  });

  it.each([0, 366, 1.5, Number.NaN])("rejects an invalid window of %s days", async (days) => {
    await expect(loadUsageSummary(days)).rejects.toThrow(/days must be/);
  });
});
