import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { BotThreadState, PullRequestSummary } from "@merge-mentor/domain/platform.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { outcomesFilePath, readOutcomesFile } from "./cache.js";
import { isCacheFresh, loadCachedOutcomes, scanOutcomes, type OutcomeAdapter } from "./scanner.js";
import type { ScannedPr } from "./types.js";

const NOW = new Date("2026-06-01T00:00:00Z");
const since = new Date("2025-06-01T00:00:00Z");

let tempPath: string;
beforeEach(async () => {
  tempPath = await fs.mkdtemp(path.join(os.tmpdir(), "mm-scan-"));
});
afterEach(async () => {
  await fs.rm(tempPath, { recursive: true, force: true });
});

const closedPr = (number: number, closedAt = "2026-01-10T00:00:00Z"): PullRequestSummary => ({
  number,
  title: `PR ${number}`,
  state: "closed",
  updatedAt: closedAt,
  merged: true,
  closedAt,
});
const openPr = (number: number): PullRequestSummary => ({
  number,
  title: `PR ${number}`,
  state: "open",
  updatedAt: "2026-05-30T00:00:00Z",
});
const thread = (isResolved: boolean): BotThreadState => ({
  path: "a.ts",
  line: 1,
  body: `**Severity**: 🟠 High\n<!-- finding-id: ${Buffer.from("a.ts:1:bug").toString("base64")} -->`,
  isResolved,
  createdAt: "2026-01-02T00:00:00Z",
});

function adapter(
  pulls: PullRequestSummary[],
  threads: (n: number) => BotThreadState[] | Error = () => []
) {
  const getBotThreadStates = vi.fn(async (n: number) => {
    const result = threads(n);
    if (result instanceof Error) throw result;
    return result;
  });
  const listPullRequests = vi.fn(async () => pulls);
  return {
    mock: { getBotThreadStates, listPullRequests },
    adapter: {
      getPlatformName: () => "github",
      getProjectIdentifier: () => "o/r",
      listPullRequests,
      getBotThreadStates,
    } as unknown as OutcomeAdapter,
  };
}

const scan = (a: OutcomeAdapter, extra = {}) =>
  scanOutcomes(a, { since, limit: 100, tempPath, project: "o/r", now: NOW, ...extra });

describe("scanOutcomes", () => {
  it("collates outcomes across PRs and records PRs with no comments", async () => {
    const { adapter: a } = adapter([closedPr(1), closedPr(2), openPr(3)], (n) =>
      n === 1 ? [thread(true), thread(false)] : n === 3 ? [thread(false)] : []
    );
    const result = await scan(a);
    expect(result.stats).toMatchObject({
      prsScanned: 3,
      prsWithComments: 2,
      total: 3,
      resolved: 1,
      openMerged: 1,
      open: 1,
    });
    expect(result.prsFetched).toBe(3);
    const file = await readOutcomesFile(outcomesFilePath(tempPath), "github", "o/r");
    expect(Object.keys(file?.prs ?? {}).toSorted()).toEqual(["1", "2", "3"]);
  });

  it("serves unchanged long-closed PRs from the cache on the next run", async () => {
    const pulls = [closedPr(1), openPr(2)];
    const first = adapter(pulls, () => [thread(true)]);
    await scan(first.adapter);

    const second = adapter(pulls, () => [thread(true)]);
    const result = await scan(second.adapter);
    expect(second.mock.getBotThreadStates).toHaveBeenCalledTimes(1);
    expect(second.mock.getBotThreadStates).toHaveBeenCalledWith(2);
    expect(result).toMatchObject({ prsFromCache: 1, prsFetched: 1 });
    expect(result.stats.total).toBe(2);
  });

  it("rescans a PR whose update time changed", async () => {
    await scan(adapter([closedPr(1)], () => [thread(false)]).adapter);
    const changed = { ...closedPr(1), updatedAt: "2026-02-01T00:00:00Z" };
    const second = adapter([changed], () => [thread(true)]);
    const result = await scan(second.adapter);
    expect(second.mock.getBotThreadStates).toHaveBeenCalledTimes(1);
    expect(result.stats.resolved).toBe(1);
  });

  it("rescans a PR that closed recently even if it looks unchanged", async () => {
    const recent = closedPr(1, "2026-05-25T00:00:00Z");
    await scan(adapter([recent], () => [thread(false)]).adapter);
    const second = adapter([recent], () => [thread(true)]);
    await scan(second.adapter);
    expect(second.mock.getBotThreadStates).toHaveBeenCalledTimes(1);
  });

  it("ignores the cache with refresh", async () => {
    await scan(adapter([closedPr(1)]).adapter);
    const second = adapter([closedPr(1)]);
    await scan(second.adapter, { refresh: true });
    expect(second.mock.getBotThreadStates).toHaveBeenCalledTimes(1);
  });

  it("scans only the requested PR, even if it is cached", async () => {
    await scan(adapter([closedPr(1), closedPr(2)]).adapter);
    const second = adapter([closedPr(1), closedPr(2)]);
    const result = await scan(second.adapter, { onlyPr: 2 });
    expect(second.mock.getBotThreadStates).toHaveBeenCalledTimes(1);
    expect(second.mock.getBotThreadStates).toHaveBeenCalledWith(2);
    expect(result.stats.prsScanned).toBe(1);
  });

  it("reports unreadable PRs and leaves them out of the stats", async () => {
    const { adapter: a } = adapter([closedPr(1), closedPr(2)], (n) =>
      n === 2 ? new Error("boom") : [thread(true)]
    );
    const result = await scan(a);
    expect(result).toMatchObject({ prsFailed: 1, prsFetched: 1 });
    expect(result.stats.prsScanned).toBe(1);
  });

  it("fails when every PR is unreadable", async () => {
    const { adapter: a } = adapter([closedPr(1), closedPr(2)], () => new Error("bad token"));
    await expect(scan(a)).rejects.toThrow(/Could not read comments on any of the 2 PRs: bad token/);
  });

  it("flags truncation when the limit is hit", async () => {
    const { adapter: a } = adapter([closedPr(1), closedPr(2), closedPr(3)]);
    const result = await scan(a, { limit: 2 });
    expect(result.truncated).toBe(true);
    expect(result.stats.prsScanned).toBe(2);
  });

  it("stores no comment text or authors in the results file", async () => {
    const { adapter: a } = adapter([closedPr(1)], () => [
      { ...thread(true), body: `${thread(true).body}\nPRIVATE-TEXT` },
    ]);
    await scan(a);
    expect(await fs.readFile(outcomesFilePath(tempPath), "utf-8")).not.toContain("PRIVATE-TEXT");
  });
});

const cachedPr = (over: Partial<ScannedPr> = {}): ScannedPr => ({
  updatedAt: "2026-01-10T00:00:00Z",
  state: "closed",
  scannedAt: "2026-06-01T00:00:00Z",
  comments: [],
  ...over,
});

describe("isCacheFresh", () => {
  it("is false without a cache entry or for open PRs", () => {
    expect(isCacheFresh(undefined, closedPr(1))).toBe(false);
    expect(isCacheFresh(cachedPr({ state: "open" }), closedPr(1))).toBe(false);
    expect(isCacheFresh(cachedPr(), openPr(1))).toBe(false);
  });

  it("is false when scanned before the grace period ended", () => {
    expect(isCacheFresh(cachedPr({ scannedAt: "2026-01-12T00:00:00Z" }), closedPr(1))).toBe(false);
  });

  it("is true for an unchanged PR scanned after the grace period", () => {
    expect(isCacheFresh(cachedPr(), closedPr(1))).toBe(true);
  });
});

describe("loadCachedOutcomes", () => {
  it("returns undefined before any scan", async () => {
    expect(await loadCachedOutcomes(tempPath, "github", "o/r", since)).toBeUndefined();
  });

  it("collates saved results inside the window without an adapter", async () => {
    await scan(
      adapter([closedPr(1), closedPr(2, "2025-01-01T00:00:00Z")], () => [thread(true)]).adapter
    );
    const cached = await loadCachedOutcomes(tempPath, "github", "o/r", since);
    expect(cached?.stats.prsScanned).toBe(1);
    expect(cached?.stats.resolved).toBe(1);
    expect(cached?.generatedAt).toBe(NOW.toISOString());
  });

  it("does not return another repository's results", async () => {
    await scan(adapter([closedPr(1)]).adapter);
    expect(await loadCachedOutcomes(tempPath, "github", "other/r", since)).toBeUndefined();
  });
});
