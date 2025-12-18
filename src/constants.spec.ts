import { describe, expect, it } from "vitest";
import {
  CATEGORY_EMOJI,
  DEFAULT_MAX_RETRIES,
  DEFAULT_PAGE_SIZE,
  DEFAULT_TIMEOUT_MS,
  RETRY_DELAY_BASE_MS,
  SEVERITY_EMOJI,
  SKIP_EXTENSIONS,
} from "./constants.js";

describe("Constants", () => {
  describe("pagination and retry constants", () => {
    it("should define DEFAULT_PAGE_SIZE", () => {
      expect(DEFAULT_PAGE_SIZE).toBe(100);
      expect(typeof DEFAULT_PAGE_SIZE).toBe("number");
    });

    it("should define DEFAULT_MAX_RETRIES", () => {
      expect(DEFAULT_MAX_RETRIES).toBe(3);
      expect(typeof DEFAULT_MAX_RETRIES).toBe("number");
    });

    it("should define DEFAULT_TIMEOUT_MS", () => {
      expect(DEFAULT_TIMEOUT_MS).toBe(60000);
      expect(typeof DEFAULT_TIMEOUT_MS).toBe("number");
    });

    it("should define RETRY_DELAY_BASE_MS", () => {
      expect(RETRY_DELAY_BASE_MS).toBe(1000);
      expect(typeof RETRY_DELAY_BASE_MS).toBe("number");
    });
  });

  describe("SKIP_EXTENSIONS", () => {
    it("should include common binary and generated file extensions", () => {
      expect(SKIP_EXTENSIONS).toContain(".lock");
      expect(SKIP_EXTENSIONS).toContain(".min.js");
      expect(SKIP_EXTENSIONS).toContain(".min.css");
      expect(SKIP_EXTENSIONS).toContain(".map");
    });

    it("should include image file extensions", () => {
      expect(SKIP_EXTENSIONS).toContain(".png");
      expect(SKIP_EXTENSIONS).toContain(".jpg");
      expect(SKIP_EXTENSIONS).toContain(".jpeg");
      expect(SKIP_EXTENSIONS).toContain(".gif");
      expect(SKIP_EXTENSIONS).toContain(".ico");
      expect(SKIP_EXTENSIONS).toContain(".svg");
    });

    it("should include font file extensions", () => {
      expect(SKIP_EXTENSIONS).toContain(".woff");
      expect(SKIP_EXTENSIONS).toContain(".woff2");
      expect(SKIP_EXTENSIONS).toContain(".ttf");
      expect(SKIP_EXTENSIONS).toContain(".eot");
    });

    it("should be readonly array", () => {
      expect(Array.isArray(SKIP_EXTENSIONS)).toBe(true);
    });
  });

  describe("SEVERITY_EMOJI", () => {
    it("should map all severity levels to emoji", () => {
      expect(SEVERITY_EMOJI.critical).toBe("🔴");
      expect(SEVERITY_EMOJI.high).toBe("🟠");
      expect(SEVERITY_EMOJI.medium).toBe("🟡");
      expect(SEVERITY_EMOJI.low).toBe("🟢");
    });

    it("should have exactly 4 severity levels", () => {
      expect(Object.keys(SEVERITY_EMOJI)).toHaveLength(4);
    });
  });

  describe("CATEGORY_EMOJI", () => {
    it("should map all categories to emoji", () => {
      expect(CATEGORY_EMOJI.bug).toBe("🐛");
      expect(CATEGORY_EMOJI.security).toBe("🔒");
      expect(CATEGORY_EMOJI.performance).toBe("⚡");
      expect(CATEGORY_EMOJI.quality).toBe("📝");
      expect(CATEGORY_EMOJI.documentation).toBe("📚");
      expect(CATEGORY_EMOJI.architecture).toBe("🏗️");
      expect(CATEGORY_EMOJI.design).toBe("🎨");
      expect(CATEGORY_EMOJI.testing).toBe("🧪");
    });

    it("should have all expected categories", () => {
      const categories = Object.keys(CATEGORY_EMOJI);
      expect(categories).toContain("bug");
      expect(categories).toContain("security");
      expect(categories).toContain("performance");
      expect(categories).toContain("quality");
      expect(categories).toContain("documentation");
      expect(categories).toContain("architecture");
      expect(categories).toContain("design");
      expect(categories).toContain("testing");
    });
  });
});
