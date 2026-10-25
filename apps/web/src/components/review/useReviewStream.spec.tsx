// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, sseFrames, sseResponse } from "../../test/sse.js";
import { useReviewStream } from "./useReviewStream.js";

const ENDPOINT = "/api/pbi/stream";

/**
 * jsdom's DOMException is not an `instanceof Error` in the test realm, unlike in
 * browsers, which the hook's abort detection relies on.
 */
class TestDOMException extends Error {
  constructor(message?: string, name = "Error") {
    super(message);
    this.name = name;
  }
}

describe("useReviewStream", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("DOMException", TestDOMException);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("starts idle", () => {
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    expect(result.current).toMatchObject({
      status: "idle",
      running: false,
      summary: null,
      error: null,
      phases: [],
      steps: [],
      entries: [],
    });
  });

  it("creates a run, streams it to completion and exposes the result", async () => {
    const onRunCreated = vi.fn();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
      .mockResolvedValueOnce(
        sseResponse([
          sseFrames([
            { type: "status", message: "Starting" },
            { type: "log", message: "a log line" },
            { type: "chunk", text: "raw chunk" },
            { type: "result", summary: { answer: 42 } },
            { type: "done" },
          ]),
        ])
      );
    const { result } = renderHook(() =>
      useReviewStream<{ answer: number }>({ endpoint: ENDPOINT, onRunCreated })
    );

    await act(() => result.current.run({ id: "PBI-1", write: false }));

    expect(result.current.status).toBe("done");
    expect(result.current.summary).toEqual({ answer: 42 });
    expect(result.current.runInput).toEqual({ id: "PBI-1", write: false });
    expect(onRunCreated).toHaveBeenCalledWith("run-1");
    expect(result.current.entries.map((entry) => [entry.kind, entry.text])).toEqual([
      ["status", "\n▸ Starting\n"],
      ["log", "a log line\n"],
      ["chunk", "raw chunk"],
    ]);

    const [createUrl, createInit] = fetchMock.mock.calls[0];
    expect(createUrl).toBe(ENDPOINT);
    expect(createInit?.method).toBe("POST");
    expect(createInit?.body).toBe(JSON.stringify({ id: "PBI-1", write: false }));
    expect(fetchMock.mock.calls[1][0]).toBe(`${ENDPOINT}?run=run-1&from=0`);
  });

  it("sends a custom request body and headers when provided", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runId: "run-2" }))
      .mockResolvedValueOnce(sseResponse([sseFrames([{ type: "done" }])]));
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    await act(() =>
      result.current.run(
        { file: "x" },
        { body: "raw-bytes", headers: { "Content-Type": "text/plain" } }
      )
    );

    const init = fetchMock.mock.calls[0][1];
    expect(init?.body).toBe("raw-bytes");
    expect(init?.headers).toEqual({ "Content-Type": "text/plain" });
  });

  it("reassembles frames split across network chunks", async () => {
    const frames = sseFrames([
      { type: "log", message: "first" },
      { type: "result", summary: "ok" },
    ]);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runId: "run-3" }))
      .mockResolvedValueOnce(sseResponse([frames.slice(0, 20), frames.slice(20)]));
    const { result } = renderHook(() => useReviewStream<string>({ endpoint: ENDPOINT }));

    await act(() => result.current.run({}));

    expect(result.current.summary).toBe("ok");
    expect(result.current.entries).toHaveLength(1);
  });

  it("ignores frames it has already seen, making reconnects idempotent", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runId: "run-4" }))
      .mockResolvedValueOnce(
        sseResponse([
          sseFrames([{ type: "log", message: "once" }], 1),
          sseFrames([{ type: "log", message: "once" }], 1),
          'data: {"type":"log","message":"no sequence id"}\n\n',
          "event: ping\n\n",
        ])
      );
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    await act(() => result.current.run({}));

    expect(result.current.entries.map((entry) => entry.text)).toEqual([
      "once\n",
      "no sequence id\n",
    ]);
  });

  it("builds the phase and step timeline from progress events", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runId: "run-5" })).mockResolvedValueOnce(
      sseResponse([
        sseFrames([
          {
            type: "progress",
            event: { kind: "phase", id: "fetch", label: "Fetching", status: "start" },
          },
          { type: "progress", event: { kind: "activity", label: "Reading diff" } },
          {
            type: "progress",
            event: { kind: "phase", id: "ai-review", label: "Reviewing", status: "start" },
          },
          { type: "progress", event: { kind: "step", label: "agent-1", status: "start" } },
          {
            type: "progress",
            event: { kind: "step", label: "agent-1", status: "done", detail: "3 findings" },
          },
          {
            type: "progress",
            event: { kind: "step", label: "agent-2", status: "error", detail: "timeout" },
          },
          {
            type: "progress",
            event: { kind: "phase", id: "ai-review", label: "Reviewed", status: "done" },
          },
          {
            type: "progress",
            event: { kind: "phase", id: "post", label: "Posting", status: "error" },
          },
        ]),
      ])
    );
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    await act(() => result.current.run({}));

    expect(result.current.phases.map((phase) => [phase.id, phase.label, phase.status])).toEqual([
      ["fetch", "Fetching", "done"],
      ["ai-review", "Reviewed", "done"],
      ["post", "Posting", "error"],
    ]);
    expect(result.current.steps.map((step) => [step.label, step.status, step.detail])).toEqual([
      ["agent-1", "done", "3 findings"],
      ["agent-2", "error", "timeout"],
    ]);
    expect(result.current.activity).toBeNull();
  });

  it("restarts a phase that is reported as started again", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runId: "run-6" })).mockResolvedValueOnce(
      sseResponse([
        sseFrames([
          {
            type: "progress",
            event: { kind: "phase", id: "ai-review", label: "Reviewing", status: "start" },
          },
          {
            type: "progress",
            event: { kind: "phase", id: "ai-review", label: "Reviewing again", status: "start" },
          },
        ]),
      ])
    );
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    await act(() => result.current.run({}));

    expect(result.current.phases).toHaveLength(1);
    expect(result.current.phases[0]).toMatchObject({ label: "Reviewing again", status: "start" });
  });

  it("accumulates live output per phase, resetting when the phase changes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runId: "run-7" })).mockResolvedValueOnce(
      sseResponse([
        sseFrames([
          { type: "stream", phase: "ai-review", delta: "Hel" },
          { type: "stream", phase: "ai-review", delta: "lo" },
          { type: "progress", event: { kind: "stream", phase: "ai-review", delta: "!" } },
          { type: "stream", phase: "verify", delta: "Next" },
        ]),
      ])
    );
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    await act(() => result.current.run({}));

    expect(result.current.live).toEqual({ phase: "verify", text: "Next" });
  });

  it("keeps the first review phase's accumulated text while it is current", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runId: "run-8" })).mockResolvedValueOnce(
      sseResponse([
        sseFrames([
          { type: "stream", phase: "ai-review", delta: "Hel" },
          { type: "stream", phase: "ai-review", delta: "lo" },
        ]),
      ])
    );
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    await act(() => result.current.run({}));

    expect(result.current.live).toEqual({ phase: "ai-review", text: "Hello" });
  });

  it("surfaces an error event and stays in the error state", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runId: "run-9" }))
      .mockResolvedValueOnce(sseResponse([sseFrames([{ type: "error", message: "AI failed" }])]));
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    await act(() => result.current.run({}));

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("AI failed");
  });

  it("surfaces the server's message when creating the run fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Bad input" }, 400));
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    await act(() => result.current.run({}));

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Bad input");
  });

  it("falls back to a status message when the create error body is unreadable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    await act(() => result.current.run({}));

    expect(result.current.error).toBe("Review request failed (HTTP 500).");
  });

  it("errors when the create response has no run id", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    await act(() => result.current.run({}));

    expect(result.current.error).toBe("Review request did not return a run id.");
  });

  it("stringifies non-Error failures while creating the run", async () => {
    fetchMock.mockRejectedValueOnce("network down");
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    await act(() => result.current.run({}));

    expect(result.current.error).toBe("network down");
  });

  it("reports a missing run as not found without retrying", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runId: "gone" }))
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    await act(() => result.current.run({}));

    expect(result.current.error).toBe(
      "This review run could not be found. It may have been cleaned up."
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reconnects with backoff after a dropped stream, then gives up", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runId: "flaky" }))
      .mockResolvedValue(new Response("", { status: 503 }));
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    act(() => {
      void result.current.run({});
    });
    await act(() => vi.advanceTimersByTimeAsync(500 + 1000 + 1500 + 2000));

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Review stream failed (HTTP 503).");
    // one create call plus five attach attempts
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("recovers when a retry succeeds after a transient failure", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runId: "retry" }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(sseResponse([sseFrames([{ type: "result", summary: "recovered" }])]));
    const { result } = renderHook(() => useReviewStream<string>({ endpoint: ENDPOINT }));

    act(() => {
      void result.current.run({});
    });
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(result.current.summary).toBe("recovered");
    expect(result.current.status).toBe("done");
  });

  it("detaches without error when stopped", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runId: "slow" })).mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        })
    );
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    act(() => {
      void result.current.run({});
    });
    await waitFor(() => expect(result.current.running).toBe(true));

    act(() => result.current.stop());

    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.error).toBeNull();
  });

  it("stops quietly when aborted while waiting to reconnect", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runId: "wait" }))
      .mockResolvedValue(new Response("", { status: 503 }));
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    act(() => {
      void result.current.run({});
    });
    await act(() => vi.advanceTimersByTimeAsync(10));
    act(() => result.current.stop());
    await act(() => vi.advanceTimersByTimeAsync(5000));

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
  });

  it("resumes a run from the URL, recovering its input and replaying the stream", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ manifest: { input: { id: "PBI-9", write: true } } }))
      .mockResolvedValueOnce(sseResponse([sseFrames([{ type: "result", summary: "resumed" }])]));

    const { result } = renderHook(() =>
      useReviewStream<string>({ endpoint: ENDPOINT, runId: "run 10" })
    );

    await waitFor(() => expect(result.current.summary).toBe("resumed"));
    expect(result.current.runInput).toEqual({ id: "PBI-9", write: true });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/review/runs/run%2010");
    expect(fetchMock.mock.calls[1][0]).toBe(`${ENDPOINT}?run=run%2010&from=0`);
  });

  it("still resumes when the manifest cannot be recovered", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(sseResponse([sseFrames([{ type: "result", summary: "ok" }])]));

    const { result } = renderHook(() =>
      useReviewStream<string>({ endpoint: ENDPOINT, runId: "run-11" })
    );

    await waitFor(() => expect(result.current.summary).toBe("ok"));
    expect(result.current.runInput).toBeNull();
  });

  it("still resumes when the manifest request throws", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(sseResponse([sseFrames([{ type: "result", summary: "ok" }])]));

    const { result } = renderHook(() =>
      useReviewStream<string>({ endpoint: ENDPOINT, runId: "run-12" })
    );

    await waitFor(() => expect(result.current.summary).toBe("ok"));
  });

  it("tracks elapsed time while running", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runId: "timer" }))
      .mockImplementationOnce(() => new Promise(() => undefined));
    const { result } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    act(() => {
      void result.current.run({});
    });
    await act(() => vi.advanceTimersByTimeAsync(2000));

    expect(result.current.running).toBe(true);
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(1500);
    expect(result.current.startedAt).not.toBeNull();
  });

  it("aborts the in-flight stream on unmount", async () => {
    let signal: AbortSignal | null | undefined;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runId: "unmount" }))
      .mockImplementationOnce((_url, init) => {
        signal = init?.signal;
        return new Promise(() => undefined);
      });
    const { result, unmount } = renderHook(() => useReviewStream({ endpoint: ENDPOINT }));

    act(() => {
      void result.current.run({});
    });
    await waitFor(() => expect(signal).toBeDefined());
    unmount();

    expect(signal?.aborted).toBe(true);
  });
});
