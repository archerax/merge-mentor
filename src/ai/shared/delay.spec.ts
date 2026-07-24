import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delay } from "./delay.js";

describe("delay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve after the given number of milliseconds", async () => {
    const promise = delay(100);

    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).resolves.toBeUndefined();
  });

  it("should not resolve before the given number of milliseconds", async () => {
    let resolved = false;
    delay(100).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });
});
