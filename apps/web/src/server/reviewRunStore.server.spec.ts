import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendEvent,
  closeEventLog,
  listRuns,
  openEventLog,
  pruneRuns,
  readEvents,
  readManifest,
  readSummary,
  runDir,
  runsDir,
  type ReviewRunManifest,
  writeEvent,
  writeManifest,
  writeSummary,
} from "./reviewRunStore.server.js";

function manifest(overrides: Partial<ReviewRunManifest> = {}): ReviewRunManifest {
  return {
    runId: "pr-42-abc",
    kind: "pr",
    targetKey: "pr:github:acme/widgets:42",
    input: { pr: 42 },
    label: "PR #42 · acme/widgets",
    createdAt: 1000,
    status: "running",
    ...overrides,
  };
}

describe("reviewRunStore.server", () => {
  let tempPath: string;

  beforeEach(() => {
    tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "mm-runs-"));
  });

  afterEach(() => {
    fs.rmSync(tempPath, { recursive: true, force: true });
  });

  it("round-trips a manifest", () => {
    writeManifest(tempPath, manifest());
    expect(readManifest(tempPath, "pr-42-abc")).toEqual(manifest());
  });

  it("rejects invalid run ids and returns null", () => {
    expect(runDir(tempPath, "../escape")).toBeNull();
    expect(readManifest(tempPath, "../escape")).toBeNull();
    expect(readEvents(tempPath, "../escape")).toEqual([]);
    expect(readSummary(tempPath, "../escape")).toBeNull();
  });

  it("tolerates a missing manifest", () => {
    expect(readManifest(tempPath, "nope")).toBeNull();
  });

  it("appends and reads events above a sequence number", () => {
    appendEvent(tempPath, "pr-42-abc", { seq: 1, event: { type: "status", message: "a" } });
    appendEvent(tempPath, "pr-42-abc", { seq: 2, event: { type: "status", message: "b" } });
    appendEvent(tempPath, "pr-42-abc", { seq: 3, event: { type: "done" } });

    expect(readEvents(tempPath, "pr-42-abc").map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(readEvents(tempPath, "pr-42-abc", 1).map((entry) => entry.seq)).toEqual([2, 3]);
    expect(readEvents(tempPath, "pr-42-abc", 3)).toEqual([]);
  });

  it("tolerates a malformed trailing event line", () => {
    appendEvent(tempPath, "pr-42-abc", { seq: 1, event: { type: "status" } });
    fs.appendFileSync(path.join(runDir(tempPath, "pr-42-abc") as string, "events.jsonl"), "{oops");

    expect(readEvents(tempPath, "pr-42-abc")).toHaveLength(1);
  });

  it("round-trips a summary", () => {
    writeSummary(tempPath, "pr-42-abc", { number: 42 });
    expect(readSummary(tempPath, "pr-42-abc")).toEqual({ number: 42 });
    expect(readSummary(tempPath, "pr-42-abc-missing")).toBeNull();
  });

  it("appends and reads events through an open descriptor", () => {
    const fd = openEventLog(tempPath, "pr-42-abc");
    expect(fd).not.toBeNull();
    writeEvent(fd as number, { seq: 1, event: { type: "status" } });
    writeEvent(fd as number, { seq: 2, event: { type: "done" } });
    closeEventLog(fd as number);

    expect(readEvents(tempPath, "pr-42-abc").map((entry) => entry.seq)).toEqual([1, 2]);
  });

  it("returns null when opening the log for an invalid run id", () => {
    expect(openEventLog(tempPath, "../escape")).toBeNull();
  });

  it("lists runs newest first", () => {
    writeManifest(tempPath, manifest({ runId: "old", createdAt: 1 }));
    writeManifest(tempPath, manifest({ runId: "new", createdAt: 5 }));

    expect(listRuns(tempPath).map((entry) => entry.runId)).toEqual(["new", "old"]);
  });

  it("returns an empty list when the runs directory is missing", () => {
    expect(listRuns(path.join(tempPath, "absent"))).toEqual([]);
  });

  it("prunes runs beyond the max count", () => {
    writeManifest(tempPath, manifest({ runId: "a", createdAt: 3 }));
    writeManifest(tempPath, manifest({ runId: "b", createdAt: 2 }));
    writeManifest(tempPath, manifest({ runId: "c", createdAt: 1 }));

    const removed = pruneRuns(tempPath, { maxCount: 2 });
    expect(removed).toEqual(["c"]);
    expect(listRuns(tempPath).map((entry) => entry.runId)).toEqual(["a", "b"]);
    expect(fs.existsSync(runsDir(tempPath))).toBe(true);
  });

  it("never prunes protected runs", () => {
    writeManifest(tempPath, manifest({ runId: "running", createdAt: 3 }));
    writeManifest(tempPath, manifest({ runId: "done", createdAt: 2, status: "done" }));

    const removed = pruneRuns(tempPath, { maxCount: 1, protect: new Set(["running"]) });
    expect(removed).toEqual(["done"]);
    expect(listRuns(tempPath).map((entry) => entry.runId)).toEqual(["running"]);
  });

  it("prunes runs older than the max age", () => {
    writeManifest(tempPath, manifest({ runId: "old", createdAt: Date.now() - 10_000 }));
    writeManifest(tempPath, manifest({ runId: "fresh", createdAt: Date.now() }));

    const removed = pruneRuns(tempPath, { maxAgeMs: 1000 });
    expect(removed).toEqual(["old"]);
    expect(listRuns(tempPath).map((entry) => entry.runId)).toEqual(["fresh"]);
  });
});
