import { describe, expect, it } from "vitest";

import { createEmitter, type SseEmitter } from "./sse.server.js";

/** Runs `produce` against an emitter and returns the frames it flushed. */
function collectFrames(produce: (emit: SseEmitter) => void): unknown[] {
  const frames: unknown[] = [];
  const emit = createEmitter((event) => frames.push(event));
  produce(emit);
  emit.flush();
  return frames;
}

describe("createEmitter", () => {
  it("forwards events emitted via send", () => {
    const frames = collectFrames((emit) => {
      emit.send({ type: "status", message: "hello" });
    });

    expect(frames).toEqual([{ type: "status", message: "hello" }]);
  });

  it("batches pushed chunks into one frame and strips ANSI escapes", () => {
    const frames = collectFrames((emit) => {
      emit.pushChunk("plain ");
      emit.pushChunk("\u001B[31mred\u001B[0m");
    });

    expect(frames).toEqual([{ type: "chunk", text: "plain red" }]);
  });

  it("flushes a stream frame when the phase changes", () => {
    const frames = collectFrames((emit) => {
      emit.pushStream("resolve", "one");
      emit.pushStream("fetch", "two");
    });

    expect(frames).toEqual([
      { type: "stream", phase: "resolve", delta: "one" },
      { type: "stream", phase: "fetch", delta: "two" },
    ]);
  });

  it("coalesces deltas for the same phase", () => {
    const frames = collectFrames((emit) => {
      emit.pushStream("resolve", "a");
      emit.pushStream("resolve", "b");
    });

    expect(frames).toEqual([{ type: "stream", phase: "resolve", delta: "ab" }]);
  });

  it("emits no frame when nothing is buffered", () => {
    const frames = collectFrames(() => {
      // no output
    });

    expect(frames).toEqual([]);
  });
});
