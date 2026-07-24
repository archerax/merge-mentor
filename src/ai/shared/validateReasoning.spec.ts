import { describe, expect, it, vi } from "vitest";
import { validateReasoning } from "./validateReasoning.js";

describe("validateReasoning", () => {
  it("should warn when reasoning is too short", () => {
    const logger = { warn: vi.fn() };

    validateReasoning(logger, "short", "test.ts", 1);

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "test.ts",
        location: "line 1",
        reasoningLength: 5,
      }),
      expect.stringContaining("Reasoning too short")
    );
  });

  it("should warn when reasoning lacks evidence and impact patterns", () => {
    const logger = { warn: vi.fn() };

    validateReasoning(logger, "a".repeat(50), "test.ts", 1);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "test.ts" }),
      expect.stringContaining("Reasoning should briefly cite the code evidence")
    );
  });

  it("should not warn when reasoning has both evidence and impact keywords", () => {
    const logger = { warn: vi.fn() };

    validateReasoning(
      logger,
      "This function has a bug that will crash on invalid input. Check line 42.",
      "test.ts",
      1
    );

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should handle numeric line number", () => {
    const logger = { warn: vi.fn() };

    validateReasoning(logger, "short", "test.ts", 42);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ location: "line 42" }),
      expect.any(String)
    );
  });

  it("should handle string location", () => {
    const logger = { warn: vi.fn() };

    validateReasoning(logger, "short", "test.ts", "general");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ location: "general" }),
      expect.any(String)
    );
  });
});
