import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendEvent, writeManifest } from "./reviewRunStore.server.js";
import { createRunStreamResponse } from "./runStream.server.js";

const RUN_ID = "pr-1-abc";

describe("createRunStreamResponse", () => {
  let tempPath: string;
  const originalTempPath = process.env.MM_TEMP_PATH;

  beforeEach(() => {
    tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "mm-runstream-"));
    process.env.MM_TEMP_PATH = tempPath;
  });

  afterEach(() => {
    fs.rmSync(tempPath, { recursive: true, force: true });
    if (originalTempPath === undefined) delete process.env.MM_TEMP_PATH;
    else process.env.MM_TEMP_PATH = originalTempPath;
  });

  it("returns 400 when no run id is supplied", () => {
    const response = createRunStreamResponse(new Request("http://localhost/api/review/stream"));
    expect(response.status).toBe(400);
  });

  it("returns 404 for an unknown run", () => {
    const response = createRunStreamResponse(
      new Request("http://localhost/api/review/stream?run=unknown")
    );
    expect(response.status).toBe(404);
  });

  it("streams a finished run with SSE headers and replays from the log", async () => {
    writeManifest(tempPath, {
      runId: RUN_ID,
      kind: "pr",
      targetKey: "t",
      input: {},
      label: "run",
      createdAt: Date.now(),
      status: "done",
    });
    appendEvent(tempPath, RUN_ID, { seq: 1, event: { type: "status", message: "a" } });
    appendEvent(tempPath, RUN_ID, { seq: 2, event: { type: "done" } });

    const response = createRunStreamResponse(
      new Request(`http://localhost/api/review/stream?run=${RUN_ID}`)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    const body = await response.text();
    expect(body).toContain('"type":"status"');
    expect(body).toContain('"type":"done"');
    expect(body).toContain("id: 1");
  });

  it("honors the from sequence parameter and ignores an invalid one", async () => {
    writeManifest(tempPath, {
      runId: RUN_ID,
      kind: "pr",
      targetKey: "t",
      input: {},
      label: "run",
      createdAt: Date.now(),
      status: "done",
    });
    appendEvent(tempPath, RUN_ID, { seq: 1, event: { type: "status", message: "a" } });
    appendEvent(tempPath, RUN_ID, { seq: 2, event: { type: "done" } });

    const fromOne = await createRunStreamResponse(
      new Request(`http://localhost/api/review/stream?run=${RUN_ID}&from=1`)
    ).text();
    expect(fromOne).not.toContain('"type":"status"');
    expect(fromOne).toContain('"type":"done"');

    const invalid = await createRunStreamResponse(
      new Request(`http://localhost/api/review/stream?run=${RUN_ID}&from=abc`)
    ).text();
    expect(invalid).toContain('"type":"status"');
  });
});
