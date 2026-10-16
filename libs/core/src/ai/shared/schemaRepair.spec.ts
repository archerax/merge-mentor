import { describe, expect, it } from "vitest";

import { buildSchemaRepairPrompt, collectSchemaRepairReasons } from "./schemaRepair.js";

describe("collectSchemaRepairReasons", () => {
  it("returns no reasons for a fully-populated file-review finding", () => {
    const parsed = {
      findings: [{ line: 5, severity: "high", category: "bug", message: "Something is wrong" }],
    };

    expect(collectSchemaRepairReasons(parsed, "file-review")).toEqual([]);
  });

  it("flags a missing message", () => {
    const parsed = { findings: [{ line: 5, severity: "high", category: "bug" }] };

    expect(collectSchemaRepairReasons(parsed, "file-review")).toEqual([
      "findings[0].message is required and must be a non-empty string",
    ]);
  });

  it("flags a whitespace-only message", () => {
    const parsed = {
      findings: [{ line: 5, severity: "high", category: "bug", message: "   " }],
    };

    expect(collectSchemaRepairReasons(parsed, "file-review")).toEqual([
      "findings[0].message is required and must be a non-empty string",
    ]);
  });

  it("does not flag a whole-file finding that omits its line for file-review", () => {
    const parsed = {
      findings: [{ severity: "high", category: "bug", message: "Applies to the whole file" }],
    };

    expect(collectSchemaRepairReasons(parsed, "file-review")).toEqual([]);
  });

  it("does not require a line for file-level or cross-file fast-review findings", () => {
    const crossFile = {
      findings: [{ severity: "high", category: "bug", message: "PR-level concern" }],
    };
    expect(collectSchemaRepairReasons(crossFile, "fast-review")).toEqual([]);

    const fileLevel = {
      findings: [{ file: "src/a.ts", severity: "high", category: "bug", message: "Whole file" }],
    };
    expect(collectSchemaRepairReasons(fileLevel, "fast-review")).toEqual([]);
  });

  it("checks findings nested under file_results for batched reviews", () => {
    const parsed = {
      file_results: {
        "src/a.ts": {
          findings: [{ line: 1, severity: "low", category: "bug", message: "ok" }],
        },
        "src/b.ts": {
          findings: [{ line: 2, severity: "low", category: "bug" }],
        },
      },
    };

    expect(collectSchemaRepairReasons(parsed, "batched-file-review")).toEqual([
      'file_results["src/b.ts"].findings[0].message is required and must be a non-empty string',
    ]);
  });

  it("requires issue text for project findings", () => {
    const parsed = { findings: [{ severity: "medium", category: "quality" }] };

    expect(collectSchemaRepairReasons(parsed, "project")).toEqual([
      "findings[0].issue is required and must be a non-empty string",
    ]);
  });

  it("never repairs prompt types without critical-field requirements", () => {
    expect(collectSchemaRepairReasons({ findings: [{}] }, "build-analysis")).toEqual([]);
    expect(collectSchemaRepairReasons({ findings: [{}] }, "unknown")).toEqual([]);
    expect(collectSchemaRepairReasons(null, "file-review")).toEqual([]);
    expect(collectSchemaRepairReasons("not an object", "file-review")).toEqual([]);
  });
});

describe("buildSchemaRepairPrompt", () => {
  it("lists the reasons and embeds the JSON schema for the prompt type", () => {
    const prompt = buildSchemaRepairPrompt("file-review", [
      "findings[0].message is required and must be a non-empty string",
    ]);

    expect(prompt).toContain("findings[0].message is required and must be a non-empty string");
    expect(prompt).toContain('"message"');
    expect(prompt).toContain("Output only the JSON object");
  });

  it("falls back to prose when no schema is registered for the prompt type", () => {
    const prompt = buildSchemaRepairPrompt("unknown", ["findings[0].message is required"]);

    expect(prompt).toContain("Follow the JSON schema described in the original instructions");
  });
});
