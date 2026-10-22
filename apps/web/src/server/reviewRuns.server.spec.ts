import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSnapshot,
  hasRun,
  startOrAttach,
  streamRun,
  subscribe,
  type StartRunOptions,
} from "./reviewRuns.server.js";
import { writeManifest } from "./reviewRunStore.server.js";

/** Creates a promise plus its externally callable resolver. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Record<string, unknown>[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
  }
  return output
    .split("\n\n")
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => chunk.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => !!line)
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

/** Options for a run that emits a status, a result, and then resolves. */
function simpleOptions(targetKey: string): StartRunOptions {
  return {
    kind: "pr",
    targetKey,
    label: `label ${targetKey}`,
    input: { pr: 1 },
    execute: async (emit) => {
      emit.send({ type: "status", message: "working" });
      emit.send({ type: "result", summary: { ok: true } });
    },
  };
}

describe("reviewRuns.server", () => {
  let tempPath: string;
  const originalTempPath = process.env.MM_TEMP_PATH;

  beforeEach(() => {
    tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "mm-registry-"));
    process.env.MM_TEMP_PATH = tempPath;
  });

  afterEach(() => {
    fs.rmSync(tempPath, { recursive: true, force: true });
    if (originalTempPath === undefined) delete process.env.MM_TEMP_PATH;
    else process.env.MM_TEMP_PATH = originalTempPath;
  });

  it("starts a run and streams status, result, then done", async () => {
    const { runId, attached } = startOrAttach(simpleOptions("t-start"));
    expect(attached).toBe(false);

    const stream = streamRun(runId, 0);
    expect(stream).not.toBeNull();
    const frames = await collect(stream as ReadableStream<Uint8Array>);
    expect(frames.map((frame) => frame.type)).toEqual(["status", "result", "done"]);
  });

  it("attaches to an in-flight run for the same target instead of restarting", async () => {
    const gate = deferred();
    const first = startOrAttach({
      kind: "pr",
      targetKey: "t-dedupe",
      label: "dedupe",
      input: {},
      execute: async (emit) => {
        emit.send({ type: "status", message: "running" });
        await gate.promise;
        emit.send({ type: "result", summary: {} });
      },
    });

    const second = startOrAttach(simpleOptions("t-dedupe"));
    expect(second).toEqual({ runId: first.runId, attached: true });

    gate.resolve();
    await collect(streamRun(first.runId, 0) as ReadableStream<Uint8Array>);
  });

  it("replays only frames above the requested sequence number", async () => {
    const { runId } = startOrAttach(simpleOptions("t-replay"));
    await collect(streamRun(runId, 0) as ReadableStream<Uint8Array>);

    const seen: number[] = [];
    const subscription = subscribe(runId, 1, (_event, seq) => seen.push(seq));
    expect(subscription?.status).toBe("done");
    expect(seen).toEqual([2, 3]);
  });

  it("emits an error frame when the executor throws", async () => {
    const { runId } = startOrAttach({
      kind: "pr",
      targetKey: "t-error",
      label: "error",
      input: {},
      execute: async () => {
        throw new Error("boom");
      },
    });

    const frames = await collect(streamRun(runId, 0) as ReadableStream<Uint8Array>);
    expect(frames).toEqual([{ type: "error", message: "boom" }, { type: "done" }]);
    expect(getSnapshot(runId)?.manifest.status).toBe("error");
  });

  it("releases the target when persisting the final frames fails", async () => {
    const options: StartRunOptions = {
      ...simpleOptions("t-disk-failure"),
      execute: async () => {
        // Replace the runs directory with a file so every later write fails.
        fs.rmSync(path.join(tempPath, "runs"), { recursive: true, force: true });
        fs.writeFileSync(path.join(tempPath, "runs"), "");
      },
    };
    const { runId } = startOrAttach(options);
    await vi.waitFor(() => expect(hasRun(runId)).toBe(false));
    fs.rmSync(path.join(tempPath, "runs"), { force: true });

    const next = startOrAttach({ ...simpleOptions("t-disk-failure"), execute: async () => {} });
    expect(next.attached).toBe(false);
  });

  it("reports a snapshot with the final summary", async () => {
    const { runId } = startOrAttach(simpleOptions("t-snapshot"));
    await collect(streamRun(runId, 0) as ReadableStream<Uint8Array>);

    const snapshot = getSnapshot(runId);
    expect(snapshot?.manifest.status).toBe("done");
    expect(snapshot?.manifest.kind).toBe("pr");
    expect(snapshot?.summary).toEqual({ ok: true });
  });

  it("surfaces a terminal error for a run interrupted by a restart", async () => {
    const runId = "pr-restart-abc";
    writeManifest(tempPath, {
      runId,
      kind: "pr",
      targetKey: "t-restart",
      input: {},
      label: "restart",
      createdAt: Date.now(),
      status: "running",
    });

    const frames = await collect(streamRun(runId, 0) as ReadableStream<Uint8Array>);
    expect(frames).toEqual([
      { type: "error", message: "Review run was interrupted by a server restart." },
      { type: "done" },
    ]);

    expect(getSnapshot(runId)?.manifest.status).toBe("running");
  });

  it("returns null / false for unknown or invalid run ids", () => {
    expect(hasRun("unknown-run-id")).toBe(false);
    expect(streamRun("unknown-run-id", 0)).toBeNull();
    expect(getSnapshot("../escape")).toBeNull();
    expect(hasRun("../escape")).toBe(false);
  });
});
