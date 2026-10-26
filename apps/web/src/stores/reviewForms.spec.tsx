// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type UseReviewForm = typeof import("./reviewForms.js").useReviewForm;

/** A hook bound to a pristine store: the module-level store is recreated for each test. */
let useReviewForm: UseReviewForm;

describe("useReviewForm", () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ useReviewForm } = await import("./reviewForms.js"));
  });

  it("starts with an empty form", () => {
    const { result } = renderHook(() => useReviewForm("pr"));

    expect(result.current).toMatchObject({ input: "", write: false, strategy: null, runs: null });
  });

  it("updates each field", () => {
    const { result } = renderHook(() => useReviewForm("pr"));

    act(() => result.current.setInput("https://github.com/acme/widgets/pull/7"));
    act(() => result.current.setWrite(true));
    act(() => result.current.setStrategy("multi-agent"));
    act(() => result.current.setRuns(3));

    expect(result.current).toMatchObject({
      input: "https://github.com/acme/widgets/pull/7",
      write: true,
      strategy: "multi-agent",
      runs: 3,
    });
  });

  it("keeps runner forms independent", () => {
    const pr = renderHook(() => useReviewForm("pr"));
    const pbi = renderHook(() => useReviewForm("pbi"));

    act(() => pr.result.current.setInput("pr-input"));

    expect(pr.result.current.input).toBe("pr-input");
    expect(pbi.result.current.input).toBe("");
  });

  it("preserves values across unmount and remount, like route navigation", () => {
    const first = renderHook(() => useReviewForm("project"));
    act(() => first.result.current.setInput("PLAN-1"));
    first.unmount();

    const second = renderHook(() => useReviewForm("project"));

    expect(second.result.current.input).toBe("PLAN-1");
  });
});
