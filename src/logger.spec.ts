import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupLogger, createChildLogger, getLogger, logger } from "./logger.js";

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
});
