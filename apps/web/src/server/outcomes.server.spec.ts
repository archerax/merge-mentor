import { loadConfig, validateConfig } from "@merge-mentor/config/config.js";
import {
  loadCachedOutcomes,
  scanOutcomes,
  type ScanOutcomesResult,
} from "@merge-mentor/core/review/outcomes/scanner.js";
import { initLogger } from "@merge-mentor/shared/logger.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadOutcomes, startOutcomesScan } from "./outcomes.server.js";

vi.mock("@merge-mentor/config/config.js", () => ({ loadConfig: vi.fn(), validateConfig: vi.fn() }));
vi.mock("@merge-mentor/core/review/outcomes/scanner.js", () => ({
  loadCachedOutcomes: vi.fn(),
  scanOutcomes: vi.fn(),
  outcomesProject: vi.fn(() => "owner/repo"),
}));
vi.mock("@merge-mentor/shared/logger.js", () => ({ initLogger: vi.fn() }));
vi.mock("./env.server.js", () => ({
  refreshEnv: vi.fn(),
  resolveTempPath: vi.fn(() => "/project/.mergementor"),
}));
vi.mock("@merge-mentor/platforms/github.js", () => ({ GitHubAdapter: vi.fn() }));
vi.mock("@merge-mentor/platforms/azure.js", () => ({ AzureDevOpsAdapter: vi.fn() }));

const result = {
  prsFetched: 3,
  prsFromCache: 1,
  prsFailed: 0,
  truncated: false,
} as ScanOutcomesResult;

let finish: (value: ScanOutcomesResult) => void = () => {};

/** Waits for the background scan's promise handlers to run. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("outcomes server", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
    vi.mocked(loadConfig).mockReturnValue({
      defaultPlatform: "github",
      tempPath: "/tmp/mm",
      github: { owner: "owner", repo: "repo" },
    } as ReturnType<typeof loadConfig>);
  });
  afterEach(async () => {
    await flush();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("loads saved results for a 12-month window without scanning", async () => {
    vi.mocked(loadCachedOutcomes).mockResolvedValue(undefined);

    const view = await loadOutcomes();

    expect(view.cached).toBeUndefined();
    expect(loadCachedOutcomes).toHaveBeenCalledWith(
      "/tmp/mm",
      "github",
      "owner/repo",
      new Date("2025-06-15T00:00:00.000Z")
    );
    expect(scanOutcomes).not.toHaveBeenCalled();
  });

  it("rejects an invalid platform", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      defaultPlatform: "gitlab",
      tempPath: "/tmp/mm",
    } as unknown as ReturnType<typeof loadConfig>);
    await expect(loadOutcomes()).rejects.toThrow(/Invalid platform/);
  });

  it("runs one scan at a time and reports progress then the result", async () => {
    vi.mocked(scanOutcomes).mockImplementation(
      (_adapter, options) =>
        new Promise((resolve) => {
          options.onProgress?.(2, 10);
          finish = resolve;
        })
    );

    expect(startOutcomesScan(false)).toMatchObject({ running: true });
    expect(startOutcomesScan(true)).toMatchObject({ running: true, done: 2, total: 10 });
    expect(scanOutcomes).toHaveBeenCalledTimes(1);
    expect(initLogger).toHaveBeenCalledTimes(1);
    expect(scanOutcomes).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        refresh: false,
        project: "owner/repo",
        since: new Date("2025-06-15T00:00:00.000Z"),
      })
    );

    finish(result);
    await flush();

    vi.mocked(loadCachedOutcomes).mockResolvedValue(undefined);
    const view = await loadOutcomes();
    expect(view.scan).toMatchObject({
      running: false,
      lastRun: { prsFetched: 3, prsFromCache: 1 },
    });
  });

  it("records a failed scan and allows another", async () => {
    vi.mocked(scanOutcomes).mockRejectedValueOnce(new Error("bad token"));
    startOutcomesScan(false);
    await flush();

    vi.mocked(loadCachedOutcomes).mockResolvedValue(undefined);
    expect((await loadOutcomes()).scan).toMatchObject({ running: false, error: "bad token" });

    vi.mocked(scanOutcomes).mockResolvedValueOnce(result);
    startOutcomesScan(true);
    await flush();
    expect(scanOutcomes).toHaveBeenCalledTimes(2);
    expect(validateConfig).toHaveBeenCalled();
  });
});
