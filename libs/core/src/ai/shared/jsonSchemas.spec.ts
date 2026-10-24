import { describe, expect, it } from "vitest";

import {
  CROSS_FILE_REVIEW_SCHEMA,
  FILE_REVIEW_SCHEMA,
  getJsonSchema,
  getStrictJsonSchema,
  PRD_CONSISTENCY_SCHEMA,
  PRD_SECTION_SCHEMA,
  PRD_IMAGE_SCHEMA,
  PRD_VERIFY_SCHEMA,
  PROJECT_REVIEW_SCHEMA,
  REVIEW_RESULT_SCHEMA,
} from "./jsonSchemas.js";

describe("jsonSchemas", () => {
  describe("getJsonSchema", () => {
    it("returns FILE_REVIEW_SCHEMA for 'file-review'", () => {
      expect(getJsonSchema("file-review")).toBe(FILE_REVIEW_SCHEMA);
    });

    it("returns CROSS_FILE_REVIEW_SCHEMA for 'cross-file-review'", () => {
      expect(getJsonSchema("cross-file-review")).toBe(CROSS_FILE_REVIEW_SCHEMA);
    });

    it.each([
      "batched-file-review",
      "fast-review",
      "multi-agent-subagent",
      "multi-agent-synthesizer",
    ] as const)("returns the shared REVIEW_RESULT_SCHEMA for '%s'", (promptType) => {
      expect(getJsonSchema(promptType)).toBe(REVIEW_RESULT_SCHEMA);
    });

    it("lets every review strategy return a per-file entry and cross-file findings", () => {
      const schema = getJsonSchema("fast-review") as {
        properties: Record<string, unknown>;
        required: string[];
      };
      expect(Object.keys(schema.properties)).toEqual(
        expect.arrayContaining(["summary", "file_results", "cross_file_findings"])
      );
      expect(schema.required).toContain("file_results");
    });

    it("keeps cross-file categories valid in cross_file_findings", () => {
      const schema = getJsonSchema("fast-review") as {
        properties: {
          cross_file_findings: {
            items: { properties: { category: { enum: string[] } } };
          };
        };
      };
      expect(schema.properties.cross_file_findings.items.properties.category.enum).toEqual(
        expect.arrayContaining(["architecture", "design", "testing"])
      );
    });

    it("returns PROJECT_REVIEW_SCHEMA for 'project'", () => {
      expect(getJsonSchema("project")).toBe(PROJECT_REVIEW_SCHEMA);
    });

    it("returns the PRD schemas for the PRD prompt types", () => {
      expect(getJsonSchema("prd-section")).toBe(PRD_SECTION_SCHEMA);
      expect(getJsonSchema("prd-consistency")).toBe(PRD_CONSISTENCY_SCHEMA);
      expect(getJsonSchema("prd-verify")).toBe(PRD_VERIFY_SCHEMA);
      expect(getJsonSchema("prd-image")).toBe(PRD_IMAGE_SCHEMA);
    });

    it("requires an image id on every image finding in strict mode", () => {
      const strict = getStrictJsonSchema("prd-image") as {
        properties: { findings: { items: { required: string[]; properties: object } } };
      };
      const items = strict.properties.findings.items;
      expect(items.required).toContain("imageId");
      expect(items.required).toContain("quote");
      expect(Object.keys(items.properties)).toContain("authorQuestion");
    });

    it("keeps the PRD author question blankable in strict mode", () => {
      const strict = getStrictJsonSchema("prd-section") as {
        properties: { findings: { items: { required: string[] } } };
      };
      expect(strict.properties.findings.items.required).toContain("authorQuestion");
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
      for (const promptType of [
        "batched-file-review",
        "fast-review",
        "multi-agent-subagent",
        "multi-agent-synthesizer",
      ] as const) {
        expect(getStrictJsonSchema(promptType)).toBeUndefined();
      }
    });

    it("returns undefined when the prompt type has no schema", () => {
      expect(getStrictJsonSchema("unknown")).toBeUndefined();
    });
  });
});
