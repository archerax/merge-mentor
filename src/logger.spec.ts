import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupLogger, createChildLogger, getLogger, initLogger, logger } from "./logger.js";
import { createFixedClock } from "./ports/clock.test-helper.js";
import { createStubEnvironment } from "./ports/environment.test-helper.js";

describe("Logger", () => {
  beforeEach(async () => {
    // Reset logger state between tests
    await cleanupLogger();
    vi.clearAllMocks();
  });

  it("creates root logger", () => {
    expect(logger).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.error).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.debug).toBeDefined();
  });

  it("creates child logger with context", () => {
    const childLogger = createChildLogger({ component: "TestComponent", userId: "123" });
    expect(childLogger).toBeDefined();
    expect(childLogger.info).toBeDefined();
  });

  it("child logger inherits parent methods", () => {
    const childLogger = createChildLogger({ service: "TestService" });
    expect(typeof childLogger.info).toBe("function");
    expect(typeof childLogger.error).toBe("function");
    expect(typeof childLogger.warn).toBe("function");
    expect(typeof childLogger.debug).toBe("function");
  });

  it("cleanup flushes and resets logger", async () => {
    const initialLogger = getLogger();
    expect(initialLogger).toBeDefined();

    await cleanupLogger();

    // After cleanup, a new logger should be created on next access
    const newLogger = getLogger();
    expect(newLogger).toBeDefined();
  });

  it("logger methods are callable", () => {
    // Verify the mocked logger methods can be called without errors
    expect(() => logger.info("test message")).not.toThrow();
    expect(() => logger.error("error message")).not.toThrow();
    expect(() => logger.warn("warning message")).not.toThrow();
    expect(() => logger.debug("debug message")).not.toThrow();
  });

  describe("initLogger", () => {
    it("sets temp path and resets logger without optional params", () => {
      initLogger("/custom/path");

      const newLogger = getLogger();
      expect(newLogger).toBeDefined();
    });

    it("applies custom clock when provided", () => {
      const fixedClock = createFixedClock("2024-06-15T12:00:00.000Z");

      initLogger("/custom/path", fixedClock);

      const newLogger = getLogger();
      expect(newLogger).toBeDefined();
    });

    it("applies custom environment when provided", () => {
      const stubEnv = createStubEnvironment({ LOG_LEVEL: "debug" });

      initLogger("/custom/path", undefined, stubEnv);

      const newLogger = getLogger();
      expect(newLogger).toBeDefined();
    });

    it("applies both clock and environment when provided", () => {
      const fixedClock = createFixedClock("2024-01-01T00:00:00.000Z");
      const stubEnv = createStubEnvironment({ LOG_LEVEL: "warn" });

      initLogger("/another/path", fixedClock, stubEnv);

      const newLogger = getLogger();
      expect(newLogger).toBeDefined();
    });
  });

  describe("cleanupLogger", () => {
    it("handles cleanup when logger has no flush method", async () => {
      const pino = (await import("pino")).default;
      vi.mocked(pino).mockImplementationOnce(
        () =>
          ({
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
            child: vi.fn(),
            level: "info",
          }) as unknown as ReturnType<typeof pino>
      );

      await cleanupLogger(); // ensure _logger is undefined
      getLogger(); // creates _logger without flush via override

      await expect(cleanupLogger()).resolves.toBeUndefined();
    });

    it("handles cleanup when logger is not initialized", async () => {
      // _logger is undefined after beforeEach cleanupLogger
      await expect(cleanupLogger()).resolves.toBeUndefined();
    });
  });
});
