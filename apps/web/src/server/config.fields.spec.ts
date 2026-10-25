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

  it("gives every field an env var, label, description, and type", () => {
    for (const section of CONFIG_SECTIONS) {
      expect(section.description.length).toBeGreaterThan(0);
      expect(section.fields.length).toBeGreaterThan(0);
      for (const field of section.fields) {
        expect(field.envVar).toMatch(/^MM_/);
        expect(field.label.length).toBeGreaterThan(0);
        expect(field.description.length).toBeGreaterThan(0);
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

  it("keeps the settings needed to run a review out of the advanced group", () => {
    const required = [
      "MM_PLATFORM",
      "MM_GITHUB_TOKEN",
      "MM_GITHUB_REPO_OWNER",
      "MM_GITHUB_REPO_NAME",
      "MM_AZURE_TOKEN",
      "MM_AZURE_ORG",
      "MM_AZURE_PROJECT",
      "MM_AZURE_REPO",
      "MM_AI_PROVIDER",
      "MM_AI_MODEL",
      "MM_COPILOT_TOKEN",
      "MM_REVIEW_STRATEGY",
    ];
    const fields = CONFIG_SECTIONS.flatMap((section) => section.fields);
    for (const envVar of required) {
      const field = fields.find((candidate) => candidate.envVar === envVar);
      expect(field).toBeDefined();
      expect(field?.advanced).toBeFalsy();
    }
  });

  it("leaves every section with at least one basic setting", () => {
    for (const section of CONFIG_SECTIONS) {
      expect(section.fields.some((field) => !field.advanced)).toBe(true);
    }
  });

  it("tags credentials and repository settings with the platform they belong to", () => {
    const fields = CONFIG_SECTIONS.flatMap((section) => section.fields);
    for (const field of fields) {
      const expected = field.envVar.startsWith("MM_AZURE_")
        ? "azure"
        : field.envVar.startsWith("MM_GITHUB_")
          ? "github"
          : undefined;
      expect({ envVar: field.envVar, platform: field.platform }).toEqual({
        envVar: field.envVar,
        platform: expected,
      });
    }
  });
});
