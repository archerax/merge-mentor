import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  JsonParseError,
  MergeMentorError,
  PlatformApiError,
  ValidationError,
} from "./index.js";

describe("Error Classes", () => {
  describe("MergeMentorError", () => {
    it("creates error with message", () => {
      const error = new MergeMentorError("Test error");

      expect(error.message).toBe("Test error");
      expect(error.name).toBe("MergeMentorError");
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("ConfigurationError", () => {
    it("creates error with field information", () => {
      const error = new ConfigurationError("GITHUB_TOKEN", "Missing required value");

      expect(error.message).toBe("Configuration error for GITHUB_TOKEN: Missing required value");
      expect(error.name).toBe("ConfigurationError");
      expect(error.field).toBe("GITHUB_TOKEN");
    });
  });

  describe("PlatformApiError", () => {
    it("creates error for GitHub platform", () => {
      const error = new PlatformApiError("github", "fetchPR", "API rate limit exceeded");

      expect(error.message).toBe("github API error during fetchPR: API rate limit exceeded");
      expect(error.name).toBe("PlatformApiError");
      expect(error.platform).toBe("github");
      expect(error.operation).toBe("fetchPR");
      expect(error.cause).toBeUndefined();
    });

    it("creates error for Azure platform with cause", () => {
      const cause = new Error("Network timeout");
      const error = new PlatformApiError("azure", "createComment", "Request failed", cause);

      expect(error.message).toBe("azure API error during createComment: Request failed");
      expect(error.platform).toBe("azure");
      expect(error.operation).toBe("createComment");
      expect(error.cause).toBe(cause);
    });
  });

  describe("JsonParseError", () => {
    it("creates error without raw content", () => {
      const error = new JsonParseError("Invalid JSON syntax");

      expect(error.message).toBe("Failed to parse JSON: Invalid JSON syntax");
      expect(error.name).toBe("JsonParseError");
      expect(error.rawContent).toBeUndefined();
    });

    it("creates error with raw content", () => {
      const rawContent = "{invalid json}";
      const error = new JsonParseError("Unexpected token", rawContent);

      expect(error.message).toBe("Failed to parse JSON: Unexpected token");
      expect(error.rawContent).toBe(rawContent);
    });
  });

  describe("ValidationError", () => {
    it("creates error with field information", () => {
      const error = new ValidationError("email", "Invalid email format");

      expect(error.message).toBe("Validation failed for email: Invalid email format");
      expect(error.name).toBe("ValidationError");
      expect(error.field).toBe("email");
    });
  });
});
