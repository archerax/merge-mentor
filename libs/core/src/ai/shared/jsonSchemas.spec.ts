import { describe, expect, it } from "vitest";

import {
  BATCHED_FILE_REVIEW_SCHEMA,
  CROSS_FILE_REVIEW_SCHEMA,
  FAST_REVIEW_SCHEMA,
  FILE_REVIEW_SCHEMA,
  getJsonSchema,
  getStrictJsonSchema,
  PROJECT_REVIEW_SCHEMA,
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

    it("returns FAST_REVIEW_SCHEMA for the multi-agent synthesizer", () => {
      expect(getJsonSchema("multi-agent-synthesizer")).toBe(FAST_REVIEW_SCHEMA);
    });

    it("returns PROJECT_REVIEW_SCHEMA for 'project'", () => {
      expect(getJsonSchema("project")).toBe(PROJECT_REVIEW_SCHEMA);
    });

    it("returns undefined for 'unknown'", () => {
      expect(getJsonSchema("unknown")).toBeUndefined();
    });
  });

  describe("getStrictJsonSchema", () => {
    it("marks every finding property as required but leaves string fields blankable", () => {
      const strict = getStrictJsonSchema("file-review") as {
        required: string[];
        properties: {
          findings: {
            items: {
              required: string[];
              additionalProperties: boolean;
              properties: Record<string, { minLength?: number; type?: unknown }>;
            };
          };
        };
      };

      const item = strict.properties.findings.items;
      expect(strict.required).toEqual(["findings"]);
      expect(item.additionalProperties).toBe(false);
      expect(item.required).toEqual(
        expect.arrayContaining(["line", "severity", "category", "message", "suggestion"])
      );
      // "message" must be present but is NOT constrained to be non-empty here;
      // emptiness is caught by the schema-repair fallback instead.
      expect(item.properties.message.minLength).toBeUndefined();
      expect(item.properties.suggestion.minLength).toBeUndefined();
    });

    it("widens optional numeric line fields to accept null", () => {
      const strict = getStrictJsonSchema("file-review") as {
        properties: {
          findings: { items: { properties: Record<string, { type?: unknown }> } };
        };
      };

      const props = strict.properties.findings.items.properties;
      expect(props.line.type).toEqual(["number", "null"]);
      expect(props.start_line.type).toEqual(["number", "null"]);
      expect(props.end_line.type).toEqual(["number", "null"]);
    });

    it("returns undefined for the batched schema because it uses an open-ended map", () => {
      expect(getStrictJsonSchema("batched-file-review")).toBeUndefined();
    });

    it("returns undefined when the prompt type has no schema", () => {
      expect(getStrictJsonSchema("unknown")).toBeUndefined();
    });
  });
});
