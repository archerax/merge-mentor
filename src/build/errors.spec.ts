import { describe, expect, it } from "vitest";
import { BuildAnalysisError } from "./errors.js";

describe("BuildAnalysisError", () => {
  it("sets its specific name while preserving the message", () => {
    const cause = new Error("network unavailable");
    const error = new BuildAnalysisError("Build could not be analyzed", { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("BuildAnalysisError");
    expect(error.message).toBe("Build could not be analyzed");
    expect(error.cause).toBe(cause);
  });
});
