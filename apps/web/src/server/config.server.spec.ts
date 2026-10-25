import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyConfigEdits, buildConfigView } from "./config.server.js";

function findField(view: ReturnType<typeof buildConfigView>, envVar: string) {
  for (const section of view.sections) {
    const field = section.fields.find((candidate) => candidate.envVar === envVar);
    if (field) return field;
  }
  return undefined;
}

describe("config.server", () => {
  let tempDir: string;
  let envFile: string;
  const originalEnvFile = process.env.MM_ENV_FILE;
  const originalTempPath = process.env.MM_TEMP_PATH;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-config-"));
    envFile = path.join(tempDir, ".env");
    process.env.MM_ENV_FILE = envFile;
    process.env.MM_TEMP_PATH = path.join(tempDir, "tmp");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalEnvFile === undefined) delete process.env.MM_ENV_FILE;
    else process.env.MM_ENV_FILE = originalEnvFile;
    if (originalTempPath === undefined) delete process.env.MM_TEMP_PATH;
    else process.env.MM_TEMP_PATH = originalTempPath;
  });

  function writeEnv(body: string): void {
    fs.writeFileSync(envFile, body, "utf8");
  }

  describe("buildConfigView", () => {
    it("builds sanitized sections with secrets masked and set flags", () => {
      writeEnv(
        [
          "MM_PLATFORM=github",
          "MM_GITHUB_TOKEN=ghp_secretvalue",
          "MM_GITHUB_REPO_OWNER=acme",
          "MM_GITHUB_REPO_NAME=widgets",
          "MM_AI_PROVIDER=opencode-sdk",
          "",
        ].join("\n")
      );

      const view = buildConfigView();

      expect(view.error).toBeNull();
      expect(view.warnings).toEqual([]);
      expect(view.sections).toHaveLength(4);

      const token = findField(view, "MM_GITHUB_TOKEN");
      expect(token).toMatchObject({ secret: true, value: null, set: true });

      const owner = findField(view, "MM_GITHUB_REPO_OWNER");
      expect(owner).toMatchObject({ secret: false, value: "acme", set: true });

      expect(findField(view, "MM_AI_PROVIDER")?.value).toBe("opencode-sdk");

      expect(findField(view, "MM_AZURE_TOKEN")?.platform).toBe("azure");
      expect(findField(view, "MM_AI_TIMEOUT")?.advanced).toBe(true);
      expect(findField(view, "MM_AI_PROVIDER")?.advanced).toBe(false);
      expect(findField(view, "MM_AI_PROVIDER")?.description.length).toBeGreaterThan(0);
    });

    it("collects a warning when required configuration is missing", () => {
      writeEnv(
        [
          "MM_PLATFORM=github",
          "MM_GITHUB_TOKEN=",
          "MM_GITHUB_REPO_OWNER=",
          "MM_GITHUB_REPO_NAME=",
          "",
        ].join("\n")
      );

      const view = buildConfigView();

      expect(view.error).toBeNull();
      expect(view.warnings).toHaveLength(1);
      expect(view.warnings[0]).toBe("GitHub token: Required for GitHub platform.");
    });
  });

  describe("applyConfigEdits", () => {
    beforeEach(() => {
      writeEnv(
        [
          "MM_PLATFORM=github",
          "MM_GITHUB_TOKEN=ghp_secretvalue",
          "MM_GITHUB_REPO_OWNER=acme",
          "MM_GITHUB_REPO_NAME=widgets",
          "",
        ].join("\n")
      );
    });

    it("rejects unknown settings", () => {
      const result = applyConfigEdits([{ envVar: "MM_NOT_REAL", value: "x" }]);
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        { envVar: "MM_NOT_REAL", message: "Unknown configuration setting." },
      ]);
    });

    it("validates number, boolean, and enum fields", () => {
      const result = applyConfigEdits([
        { envVar: "MM_AI_TIMEOUT", value: "abc" },
        { envVar: "MM_VERIFY_PBI", value: "maybe" },
        { envVar: "MM_PLATFORM", value: "gitlab" },
      ]);

      expect(result.ok).toBe(false);
      expect(result.errors.map((error) => error.message)).toEqual([
        "Must be a positive whole number.",
        "Must be true or false.",
        "Must be one of: azure, github.",
      ]);
    });

    it("rejects unencodable secret values and malformed copilot tokens", () => {
      const result = applyConfigEdits([
        { envVar: "MM_AI_API_KEY", value: `bad"quote'here` },
        { envVar: "MM_COPILOT_TOKEN", value: "not-a-pat" },
      ]);

      expect(result.ok).toBe(false);
      expect(result.errors.map((error) => error.message)).toEqual([
        "Value contains characters that cannot be stored in a .env file.",
        "Copilot tokens must start with 'github_pat_'.",
      ]);
    });

    it("persists valid edits and returns the refreshed view", () => {
      const result = applyConfigEdits([
        { envVar: "MM_AI_MODEL", value: "gpt-5" },
        { envVar: "MM_GITHUB_REPO_NAME", value: "" },
      ]);

      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);

      const written = fs.readFileSync(envFile, "utf8");
      expect(written).toContain("MM_AI_MODEL=gpt-5");
      expect(written).not.toContain("MM_GITHUB_REPO_NAME=widgets");
      expect(findField(result.view, "MM_AI_MODEL")?.value).toBe("gpt-5");
    });

    it("does not touch the env file when edits are empty", () => {
      const before = fs.readFileSync(envFile, "utf8");
      const result = applyConfigEdits([]);
      expect(result.ok).toBe(true);
      expect(fs.readFileSync(envFile, "utf8")).toBe(before);
    });
  });
});
