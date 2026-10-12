import { describe, expect, it } from "vitest";

import { CONFIG_SECTIONS } from "./config.fields.js";

describe("CONFIG_SECTIONS", () => {
  it("exposes the expected sections", () => {
    expect(CONFIG_SECTIONS.map((section) => section.title)).toEqual([
      "Platform",
      "AI Provider",
      "Review",
      "Behavior & Runtime",
    ]);
  });

  it("gives every field an env var, label, and type", () => {
    for (const section of CONFIG_SECTIONS) {
      expect(section.description.length).toBeGreaterThan(0);
      expect(section.fields.length).toBeGreaterThan(0);
      for (const field of section.fields) {
        expect(field.envVar).toMatch(/^MM_/);
        expect(field.label.length).toBeGreaterThan(0);
        expect(["text", "number", "boolean", "enum", "secret"]).toContain(field.type);
      }
    }
  });

  it("provides options for every enum field and none for non-enum fields", () => {
    const fields = CONFIG_SECTIONS.flatMap((section) => section.fields);
    const enumFields = fields.filter((field) => field.type === "enum");
    const nonEnumFields = fields.filter((field) => field.type !== "enum");

    expect(enumFields.length).toBeGreaterThan(0);
    expect(nonEnumFields.length).toBeGreaterThan(0);
    for (const field of enumFields) {
      expect(field.options?.length ?? 0).toBeGreaterThan(0);
    }
    for (const field of nonEnumFields) {
      expect(field.options).toBeUndefined();
    }
  });

  it("uses unique environment variables across all sections", () => {
    const envVars = CONFIG_SECTIONS.flatMap((section) =>
      section.fields.map((field) => field.envVar)
    );
    expect(new Set(envVars).size).toBe(envVars.length);
  });
});
