import { describe, expect, it } from "vitest";

import { createSseResponse, type SseEmitter } from "./sse.server.js";

async function collectFrames(run: (emit: SseEmitter) => Promise<void>): Promise<unknown[]> {
  const stream = createSseResponse(run);
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
    .map((chunk) => JSON.parse(chunk.replace(/^data: /, "")) as unknown);
}

describe("createSseResponse", () => {
  it("forwards events emitted via send", async () => {
    const frames = await collectFrames(async (emit) => {
      emit.send({ type: "status", message: "hello" });
    });

    expect(frames).toEqual([{ type: "status", message: "hello" }]);
  });

  it("batches pushed chunks into one frame and strips ANSI escapes", async () => {
    const frames = await collectFrames(async (emit) => {
      emit.pushChunk("plain ");
      emit.pushChunk("\u001B[31mred\u001B[0m");
    });

    expect(frames).toEqual([{ type: "chunk", text: "plain red" }]);
  });

  it("flushes a stream frame when the phase changes", async () => {
    const frames = await collectFrames(async (emit) => {
      emit.pushStream("resolve", "one");
      emit.pushStream("fetch", "two");
    });

    expect(frames).toEqual([
      { type: "stream", phase: "resolve", delta: "one" },
      { type: "stream", phase: "fetch", delta: "two" },
    ]);
  });

  it("coalesces deltas for the same phase", async () => {
    const frames = await collectFrames(async (emit) => {
      emit.pushStream("resolve", "a");
      emit.pushStream("resolve", "b");
    });

    expect(frames).toEqual([{ type: "stream", phase: "resolve", delta: "ab" }]);
  });

  it("emits an error frame when run throws an Error", async () => {
    const frames = await collectFrames(async () => {
      throw new Error("boom");
    });

    expect(frames).toEqual([{ type: "error", message: "boom" }]);
  });

  it("stringifies non-Error thrown values", async () => {
    const frames = await collectFrames(async () => {
      throw "just a string";
    });

    expect(frames).toEqual([{ type: "error", message: "just a string" }]);
  });

  it("emits no frame when nothing is buffered", async () => {
    const frames = await collectFrames(async () => {
      // no output
    });

    expect(frames).toEqual([]);
  });
});
