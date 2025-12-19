import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractRetryAfter,
  isRateLimitError,
  withRateLimit,
  withRateLimitHandling,
} from "./rateLimitHandler.js";

describe("rateLimitHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("isRateLimitError", () => {
    it("returns false for non-error values", () => {
      expect(isRateLimitError(null)).toBe(false);
      expect(isRateLimitError(undefined)).toBe(false);
      expect(isRateLimitError("error")).toBe(false);
      expect(isRateLimitError(123)).toBe(false);
    });

    it("detects GitHub 403 rate limit errors", () => {
      const error = {
        status: 403,
        message: "API rate limit exceeded",
      };

      expect(isRateLimitError(error)).toBe(true);
    });

    it("detects GitHub 403 rate limit errors case-insensitively", () => {
      const error = {
        status: 403,
        message: "RATE LIMIT exceeded",
      };

      expect(isRateLimitError(error)).toBe(true);
    });

    it("returns false for non-rate-limit 403 errors", () => {
      const error = {
        status: 403,
        message: "Forbidden",
      };

      expect(isRateLimitError(error)).toBe(false);
    });

    it("detects standard 429 Too Many Requests", () => {
      const error = { status: 429 };

      expect(isRateLimitError(error)).toBe(true);
    });

    it("detects Azure DevOps 429 errors", () => {
      const error = { statusCode: 429 };

      expect(isRateLimitError(error)).toBe(true);
    });

    it("returns false for non-rate-limit status codes", () => {
      expect(isRateLimitError({ status: 404 })).toBe(false);
      expect(isRateLimitError({ status: 500 })).toBe(false);
      expect(isRateLimitError({ statusCode: 401 })).toBe(false);
    });
  });

  describe("extractRetryAfter", () => {
    it("returns undefined for non-error values", () => {
      expect(extractRetryAfter(null)).toBeUndefined();
      expect(extractRetryAfter(undefined)).toBeUndefined();
      expect(extractRetryAfter("error")).toBeUndefined();
    });

    it("returns undefined for errors without response", () => {
      const error = { status: 429 };

      expect(extractRetryAfter(error)).toBeUndefined();
    });

    it("extracts Retry-After from string seconds", () => {
      const error = {
        response: {
          headers: {
            "retry-after": "60",
          },
        },
      };

      expect(extractRetryAfter(error)).toBe(60000);
    });

    it("extracts Retry-After from number seconds", () => {
      const error = {
        response: {
          headers: {
            "retry-after": 30,
          },
        },
      };

      expect(extractRetryAfter(error)).toBe(30000);
    });

    it("handles capitalized Retry-After header", () => {
      const error = {
        response: {
          headers: {
            "Retry-After": "45",
          },
        },
      };

      expect(extractRetryAfter(error)).toBe(45000);
    });

    it("extracts X-RateLimit-Reset timestamp", () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 120;
      const error = {
        response: {
          headers: {
            "x-ratelimit-reset": futureTimestamp.toString(),
          },
        },
      };

      const result = extractRetryAfter(error);
      expect(result).toBeGreaterThanOrEqual(119000);
      expect(result).toBeLessThanOrEqual(121000);
    });

    it("handles X-RateLimit-Reset as number", () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 60;
      const error = {
        response: {
          headers: {
            "x-ratelimit-reset": futureTimestamp,
          },
        },
      };

      const result = extractRetryAfter(error);
      expect(result).toBeGreaterThanOrEqual(59000);
      expect(result).toBeLessThanOrEqual(61000);
    });

    it("handles past X-RateLimit-Reset timestamp", () => {
      const pastTimestamp = Math.floor(Date.now() / 1000) - 10;
      const error = {
        response: {
          headers: {
            "x-ratelimit-reset": pastTimestamp,
          },
        },
      };

      expect(extractRetryAfter(error)).toBe(0);
    });

    it("returns undefined for invalid header values", () => {
      const error = {
        response: {
          headers: {
            "retry-after": "invalid",
          },
        },
      };

      expect(extractRetryAfter(error)).toBeUndefined();
    });

    it("returns undefined when headers are missing", () => {
      const error = {
        response: {},
      };

      expect(extractRetryAfter(error)).toBeUndefined();
    });
  });

  describe("withRateLimitHandling", () => {
    it("returns result on successful execution", async () => {
      const fn = vi.fn().mockResolvedValue("success");

      const result = await withRateLimitHandling(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("throws immediately for non-rate-limit errors", async () => {
      const error = new Error("Network error");
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withRateLimitHandling(fn)).rejects.toThrow("Network error");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries on rate limit error", async () => {
      const fn = vi.fn().mockRejectedValueOnce({ status: 429 }).mockResolvedValue("success");

      vi.useFakeTimers();

      const promise = withRateLimitHandling(fn, { baseDelayMs: 100, maxRetries: 3 });

      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it("uses exponential backoff for retries", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce({ status: 429 })
        .mockRejectedValueOnce({ status: 429 })
        .mockResolvedValue("success");

      vi.useFakeTimers();
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const promise = withRateLimitHandling(fn, { baseDelayMs: 1000, maxRetries: 3 });

      await vi.advanceTimersByTimeAsync(10000);

      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(3);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it("respects Retry-After header when provided", async () => {
      const error = {
        status: 429,
        response: {
          headers: {
            "retry-after": "5",
          },
        },
      };

      const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("success");

      vi.useFakeTimers();
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const promise = withRateLimitHandling(fn, { maxRetries: 3 });

      await vi.advanceTimersByTimeAsync(6000);

      const result = await promise;

      expect(result).toBe("success");
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Rate limit encountered")
      );

      vi.useRealTimers();
    });

    it("throws after exceeding max retries", async () => {
      const error = { status: 429, message: "Rate limited" };
      const fn = vi.fn().mockRejectedValue(error);

      vi.useFakeTimers();
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const promise = withRateLimitHandling(fn, { maxRetries: 2, baseDelayMs: 100 });

      // Advance timers and wait for completion
      const advancePromise = vi.advanceTimersByTimeAsync(10000);

      await expect(Promise.all([promise, advancePromise])).rejects.toEqual(error);

      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it("caps delay at maxDelayMs", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce({ status: 429 })
        .mockRejectedValueOnce({ status: 429 })
        .mockResolvedValue("success");

      vi.useFakeTimers();
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const promise = withRateLimitHandling(fn, {
        baseDelayMs: 10000,
        maxDelayMs: 5000,
        maxRetries: 3,
      });

      await vi.advanceTimersByTimeAsync(15000);

      const result = await promise;

      expect(result).toBe("success");
      expect(consoleWarnSpy.mock.calls[0][0]).toContain("5000ms");

      vi.useRealTimers();
    });

    it("uses custom isRateLimitError function", async () => {
      const customError = { code: "CUSTOM_RATE_LIMIT" };
      const fn = vi.fn().mockRejectedValueOnce(customError).mockResolvedValue("success");

      const customCheck = (error: unknown): boolean => {
        return (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "CUSTOM_RATE_LIMIT"
        );
      };

      vi.useFakeTimers();

      const promise = withRateLimitHandling(fn, {
        isRateLimitError: customCheck,
        baseDelayMs: 100,
      });

      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it("uses custom extractRetryAfter function", async () => {
      const error = { status: 429, customRetryAfter: 3 };
      const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("success");

      const customExtract = (err: unknown): number | undefined => {
        if (
          typeof err === "object" &&
          err !== null &&
          "customRetryAfter" in err &&
          typeof err.customRetryAfter === "number"
        ) {
          return err.customRetryAfter * 1000;
        }
        return undefined;
      };

      vi.useFakeTimers();

      const promise = withRateLimitHandling(fn, {
        extractRetryAfter: customExtract,
      });

      await vi.advanceTimersByTimeAsync(4000);

      const result = await promise;

      expect(result).toBe("success");

      vi.useRealTimers();
    });

    it("handles maxRetries of 0", async () => {
      const error = { status: 429 };
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withRateLimitHandling(fn, { maxRetries: 0 })).rejects.toEqual(error);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("withRateLimit", () => {
    it("wraps function with rate limit handling", async () => {
      const originalFn = vi.fn().mockResolvedValue("result");
      const wrapped = withRateLimit(originalFn);

      const result = await wrapped("arg1", "arg2");

      expect(result).toBe("result");
      expect(originalFn).toHaveBeenCalledWith("arg1", "arg2");
    });

    it("forwards arguments correctly", async () => {
      const originalFn = vi.fn((a: number, b: string) => Promise.resolve(a + b));
      const wrapped = withRateLimit(originalFn);

      const result = await wrapped(42, "test");

      expect(result).toBe("42test");
      expect(originalFn).toHaveBeenCalledWith(42, "test");
    });

    it("retries on rate limit errors", async () => {
      const originalFn = vi
        .fn()
        .mockRejectedValueOnce({ status: 429 })
        .mockResolvedValue("success");

      const wrapped = withRateLimit(originalFn, { baseDelayMs: 100 });

      vi.useFakeTimers();

      const promise = wrapped();

      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result).toBe("success");
      expect(originalFn).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it("passes options to underlying handler", async () => {
      const customError = { myRateLimit: true };
      const originalFn = vi.fn().mockRejectedValueOnce(customError).mockResolvedValue("ok");

      const wrapped = withRateLimit(originalFn, {
        isRateLimitError: (err) => typeof err === "object" && err !== null && "myRateLimit" in err,
        baseDelayMs: 100,
      });

      vi.useFakeTimers();

      const promise = wrapped();

      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result).toBe("ok");

      vi.useRealTimers();
    });
  });
});
