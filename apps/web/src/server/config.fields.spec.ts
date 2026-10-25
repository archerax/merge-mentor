import { describe, expect, it } from "vitest";

import { CONFIG_SECTIONS } from "./config.fields.js";

function findField(envVar: string) {
  return CONFIG_SECTIONS.flatMap((section) => section.fields).find(
    (candidate) => candidate.envVar === envVar
  );
}

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
        expect(field.label).not.toMatch(/MM_[A-Z_]+|--[a-z-]+/);
        expect(field.description).not.toMatch(/MM_[A-Z_]+|--[a-z-]+/);
        expect(field.note ?? "").not.toMatch(/MM_[A-Z_]+|--[a-z-]+/);
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

  it.each([
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
  ])("keeps %s, which a review needs, out of the advanced group", (envVar) => {
    const field = findField(envVar);

    expect(field).toBeDefined();
    expect(field?.advanced).toBeFalsy();
  });

  it("leaves every section with at least one basic setting", () => {
    for (const section of CONFIG_SECTIONS) {
      expect(section.fields.some((field) => !field.advanced)).toBe(true);
    }
  });

  it.each([
    ["MM_AZURE_TOKEN", "azure"],
    ["MM_AZURE_ORG", "azure"],
    ["MM_AZURE_PROJECT", "azure"],
    ["MM_AZURE_REPO", "azure"],
    ["MM_GITHUB_TOKEN", "github"],
    ["MM_GITHUB_REPO_OWNER", "github"],
    ["MM_GITHUB_REPO_NAME", "github"],
    ["MM_PLATFORM", undefined],
    ["MM_AI_PROVIDER", undefined],
  ])("tags %s with platform %s", (envVar, platform) => {
    expect(findField(envVar)?.platform).toBe(platform);
  });
});
