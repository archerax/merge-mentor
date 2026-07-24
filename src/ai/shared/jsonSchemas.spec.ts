import { describe, expect, it } from "vitest";

import {
  BATCHED_FILE_REVIEW_SCHEMA,
  CROSS_FILE_REVIEW_SCHEMA,
  FAST_REVIEW_SCHEMA,
  FILE_REVIEW_SCHEMA,
  getJsonSchema,
} from "./jsonSchemas.js";

describe("jsonSchemas", () => {
  describe("getJsonSchema", () => {
    it("returns FILE_REVIEW_SCHEMA for 'file-review'", () => {
      expect(getJsonSchema("file-review")).toBe(FILE_REVIEW_SCHEMA);
    });

    it("returns CROSS_FILE_REVIEW_SCHEMA for 'cross-file-review'", () => {
      expect(getJsonSchema("cross-file-review")).toBe(CROSS_FILE_REVIEW_SCHEMA);
    });

    it("returns BATCHED_FILE_REVIEW_SCHEMA for 'batched-file-review'", () => {
      expect(getJsonSchema("batched-file-review")).toBe(BATCHED_FILE_REVIEW_SCHEMA);
    });

    it("returns FAST_REVIEW_SCHEMA for 'fast-review'", () => {
      expect(getJsonSchema("fast-review")).toBe(FAST_REVIEW_SCHEMA);
    });

    it("returns undefined for 'unknown'", () => {
      expect(getJsonSchema("unknown")).toBeUndefined();
    });
  });
});
