import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isEncodableEnvValue,
  providedEnvVars,
  refreshEnv,
  resolveTempPath,
  resolveWritableEnvFile,
  writeEnvValues,
} from "./env.server.js";

const projectBase = process.env.INIT_CWD ?? process.cwd();

describe("env.server", () => {
  let tempDir: string;
  const originalEnvFile = process.env.MM_ENV_FILE;
  const originalTempPath = process.env.MM_TEMP_PATH;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-env-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalEnvFile === undefined) delete process.env.MM_ENV_FILE;
    else process.env.MM_ENV_FILE = originalEnvFile;
    if (originalTempPath === undefined) delete process.env.MM_TEMP_PATH;
    else process.env.MM_TEMP_PATH = originalTempPath;
  });

  describe("isEncodableEnvValue", () => {
    it("accepts unquoted characters", () => {
      expect(isEncodableEnvValue("https://dev.azure.com/org/proj")).toBe(true);
      expect(isEncodableEnvValue("a-b_c.d/e:f@g+h")).toBe(true);
      expect(isEncodableEnvValue("")).toBe(true);
    });

    it("accepts whitespace-only values that need quoting", () => {
      expect(isEncodableEnvValue("has spaces")).toBe(true);
    });

    it("accepts values containing only a single quote", () => {
      expect(isEncodableEnvValue("it's fine")).toBe(true);
    });

    it("rejects values mixing a single quote with a double quote or backslash", () => {
      expect(isEncodableEnvValue(`it's "quoted"`)).toBe(false);
      expect(isEncodableEnvValue("it's \\ escaped")).toBe(false);
    });
  });

  describe("resolveTempPath", () => {
    it("defaults to .mergementor under the project base", () => {
      delete process.env.MM_TEMP_PATH;
      expect(resolveTempPath()).toBe(path.join(projectBase, ".mergementor"));
    });

    it("resolves a relative MM_TEMP_PATH against the project base", () => {
      process.env.MM_TEMP_PATH = "./custom-tmp";
      expect(resolveTempPath()).toBe(path.resolve(projectBase, "custom-tmp"));
    });

    it("keeps an absolute MM_TEMP_PATH", () => {
      const absolute = path.join(tempDir, "abs");
      process.env.MM_TEMP_PATH = absolute;
      expect(resolveTempPath()).toBe(absolute);
    });
  });

  describe("resolveWritableEnvFile", () => {
    it("uses MM_ENV_FILE when set", () => {
      const target = path.join(tempDir, "custom.env");
      process.env.MM_ENV_FILE = target;
      expect(resolveWritableEnvFile()).toBe(target);
    });

    it("defaults to .env under the project base", () => {
      delete process.env.MM_ENV_FILE;
      expect(resolveWritableEnvFile()).toBe(path.join(projectBase, ".env"));
    });
  });

  describe("writeEnvValues", () => {
    it("creates a new .env file with the provided values", () => {
      const file = path.join(tempDir, ".env");
      writeEnvValues(file, new Map([["MM_PLATFORM", "github"]]));

      expect(fs.readFileSync(file, "utf8")).toBe("MM_PLATFORM=github\n");
    });

    it("replaces, removes, and appends keys while preserving comments and order", () => {
      const file = path.join(tempDir, ".env");
      fs.writeFileSync(file, "# comment\nMM_PLATFORM=github\n\nMM_AI_MODEL=old\n", "utf8");

      writeEnvValues(
        file,
        new Map<string, string | null>([
          ["MM_AI_MODEL", "new-model"],
          ["MM_PLATFORM", null],
          ["MM_NEW", "value"],
        ])
      );

      expect(fs.readFileSync(file, "utf8")).toBe(
        "# comment\n\nMM_AI_MODEL=new-model\n\nMM_NEW=value\n"
      );
    });

    it("quotes values that contain spaces", () => {
      const file = path.join(tempDir, ".env");
      writeEnvValues(file, new Map([["MM_NOTE", "hello world"]]));
      expect(fs.readFileSync(file, "utf8")).toBe("MM_NOTE='hello world'\n");
    });

    it("double-quotes values containing a single quote", () => {
      const file = path.join(tempDir, ".env");
      writeEnvValues(file, new Map([["MM_NOTE", "it's here"]]));
      expect(fs.readFileSync(file, "utf8")).toBe(`MM_NOTE="it's here"\n`);
    });

    it("matches keys written with an export prefix", () => {
      const file = path.join(tempDir, ".env");
      fs.writeFileSync(file, "export MM_PLATFORM=azure\n", "utf8");
      writeEnvValues(file, new Map([["MM_PLATFORM", "github"]]));
      expect(fs.readFileSync(file, "utf8")).toBe("MM_PLATFORM=github\n");
    });
  });

  describe("refreshEnv", () => {
    it("loads values from MM_ENV_FILE into process.env and providedEnvVars", () => {
      const file = path.join(tempDir, ".env");
      fs.writeFileSync(file, "MM_TEST_REFRESH_KEY=hello\n", "utf8");
      process.env.MM_ENV_FILE = file;

      refreshEnv();

      expect(process.env.MM_TEST_REFRESH_KEY).toBe("hello");
      expect(providedEnvVars.has("MM_TEST_REFRESH_KEY")).toBe(true);

      delete process.env.MM_TEST_REFRESH_KEY;
    });

    it("restores shell values and clears env-only keys on refresh", () => {
      const file = path.join(tempDir, ".env");
      fs.writeFileSync(file, "MM_TEST_RESTORE=from-file\n", "utf8");
      process.env.MM_ENV_FILE = file;
      refreshEnv();
      expect(process.env.MM_TEST_RESTORE).toBe("from-file");

      fs.writeFileSync(file, "", "utf8");
      refreshEnv();
      expect(process.env.MM_TEST_RESTORE).toBeUndefined();
    });
  });
});
